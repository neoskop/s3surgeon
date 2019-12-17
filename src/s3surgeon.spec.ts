import * as AWS from 'aws-sdk';
import * as AWSMock from 'aws-sdk-mock';
import {
  HeadObjectOutput,
  ListObjectsOutput,
  ManagedUpload
} from 'aws-sdk/clients/s3';
import * as fs from 'fs';
import * as path from 'path';
import { S3Surgeon } from './s3surgeon';
import { S3SurgeonOptions } from './s3surgeon-options.interface';

const setupService = (opts: Partial<S3SurgeonOptions> = {}): S3Surgeon => {
  const mergedOpts = Object.assign(
    {
      accessKeyId: '',
      secretAccessKey: '',
      region: '',
      bucket: 'bucket-1',
      directory: path.resolve(__dirname, '..', 'test', 'local'),
      hashFile: path.resolve(__dirname, '..', 'test', 's3-hashes.json'),
      purge: true
    },
    opts
  );

  const sut = new S3Surgeon(mergedOpts);
  AWSMock.setSDKInstance(AWS);

  AWSMock.mock(
    'S3',
    'listObjects',
    async (
      params: AWS.S3.ListObjectsRequest,
      callback: (err: any, data: ListObjectsOutput) => void
    ) => {
      if (mergedOpts.bucket === 'bucket-2001') {
        // listObjects only ever returns 1000 files at once, so:
        // mock bucket with more than 2000 files here
        const start = Number(params.Marker) || 0;
        const resultLength = Math.min(Math.max(2001 - start, 0), 1000);

        callback(null, {
          Contents: Array.from({ length: resultLength }, (_, idx) => ({
            Key: `${start + idx + 1}`
          })),
          IsTruncated: resultLength === 1000
        });
        return;
      }

      const bucketDir = path.resolve(
        __dirname,
        '..',
        'test',
        mergedOpts.bucket
      );
      const files = await fs.promises.readdir(bucketDir);
      const Contents = files.map(f => {
        return { Key: f };
      });
      callback(null, {
        Contents
      });
    }
  );

  AWSMock.mock(
    'S3',
    'deleteObjects',
    (params: any, callback: (err: any) => void) => {
      callback(null);
    }
  );

  AWSMock.mock(
    'S3',
    'upload',
    (
      params: any,
      callback: (err: any, data: ManagedUpload.SendData) => void
    ) => {
      callback(null, {
        Location: `https://example.org/${params.Key}`,
        ETag: '',
        Bucket: mergedOpts.bucket,
        Key: params.Key
      });
    }
  );

  AWSMock.mock(
    'S3',
    'headObject',
    (params: any, callback: (err: any, data: HeadObjectOutput) => void) => {
      callback(null, {});
    }
  );

  sut.s3 = new AWS.S3();

  ['upload', 'deleteObjects', 'listObjects'].forEach(key => {
    jest.spyOn(sut.s3, key as jest.FunctionPropertyNames<AWS.S3>);
  });
  return sut;
};

afterEach(async () => {
  const hashFile = path.resolve(__dirname, '..', 'test', 's3-hashes.json');
  if (fs.existsSync(hashFile)) {
    await fs.promises.unlink(hashFile);
  }
  AWSMock.restore('S3');
});

test('upload all non-existing files', async () => {
  const sut = setupService();
  await sut.sync();
  expect(sut.s3.upload).toHaveBeenCalledTimes(2);
});

test('set charset in content-type header', async () => {
  const sut = setupService({ bucket: 'bucket-2' });
  await sut.sync();
  expect(sut.s3.upload).toHaveBeenCalledWith(
    expect.objectContaining({
      ContentType: 'text/plain; charset=utf-8'
    }),
    expect.any(Function)
  );
});

test('enable caching for text files', async () => {
  const sut = setupService({
    bucket: 'bucket-1'
  });
  await sut.sync();
  expect(sut.s3.upload).toHaveBeenCalledWith(
    expect.objectContaining({
      CacheControl: expect.stringMatching(/max-age=\d+/)
    }),
    expect.any(Function)
  );
});

test('disable caching for HTML and JSON', async () => {
  const sut = setupService({
    bucket: 'bucket-1',
    directory: path.resolve(__dirname, '..', 'test', 'local-2')
  });
  await sut.sync();
  expect(sut.s3.upload).toHaveBeenCalledWith(
    expect.objectContaining({
      CacheControl: 'no-cache',
      Key: 'bar.html'
    }),
    expect.any(Function)
  );
  expect(sut.s3.upload).toHaveBeenCalledWith(
    expect.objectContaining({
      CacheControl: 'no-cache',
      Key: 'foo.json'
    }),
    expect.any(Function)
  );
});

test("delete files that don't exist locally", async () => {
  const sut = setupService({ bucket: 'bucket-2' });
  await sut.sync();
  expect(sut.s3.deleteObjects).toHaveBeenCalledTimes(1);
  expect(sut.s3.deleteObjects).toHaveBeenCalledWith(
    expect.objectContaining({
      Delete: {
        Objects: [{ Key: 'baz.txt' }]
      }
    }),
    expect.any(Function)
  );
});

test("delete files that don't exist locally when there are more than 1000 remote objects", async () => {
  const sut = setupService({ bucket: 'bucket-2001' });
  await sut.sync();
  expect(sut.s3.listObjects).toHaveBeenCalledTimes(4);
  expect(sut.s3.deleteObjects).toHaveBeenCalledTimes(3);

  expect.extend({
    toBeArrayOfLength(received, length: number) {
      const pass = received.length === length;
      return {
        message: () =>
          `expected ${this.utils.printReceived(
            received
          )} to have ${length} elements`,
        pass
      };
    }
  });

  expect(sut.s3.deleteObjects).toHaveBeenCalledWith(
    expect.objectContaining({
      Delete: {
        Objects: expect.any(Array)
      }
    }),
    expect.any(Function)
  );
  expect(
    (sut.s3.deleteObjects as any).mock.calls[0][0].Delete.Objects.length
  ).toEqual(2001);
});
