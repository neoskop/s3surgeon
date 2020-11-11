import * as AWS from 'aws-sdk';
import { AWSError } from 'aws-sdk';
import S3, { ManagedUpload } from 'aws-sdk/clients/s3';
import chalk from 'chalk';
import crypto from 'crypto';
import * as fs from 'fs';
import * as mimetypes from 'mime-types';
import pLimit from 'p-limit';
import * as path from 'path';
import { S3Error } from './s3.error';
import { S3SurgeonOptions } from './s3surgeon-options.interface';

export class S3Surgeon {
  public s3: AWS.S3;
  private includeRegex: RegExp | null = null;
  private limit: pLimit.Limit;

  constructor(private readonly opts: S3SurgeonOptions) {
    const clientOpts: S3.Types.ClientConfiguration = {
      accessKeyId: opts.accessKeyId,
      secretAccessKey: opts.secretAccessKey,
      s3ForcePathStyle: opts.forcePathStyle,
      signatureVersion: `v${opts.signatureVersion}`,
    };

    if (opts.endpoint) {
      clientOpts.endpoint = opts.endpoint;
    } else {
      clientOpts.region = opts.region;
    }

    if (this.opts.include !== undefined) {
      this.includeRegex = new RegExp(this.opts.include);
    }

    this.s3 = new AWS.S3(clientOpts);
    this.limit = pLimit(10);
  }

  public async sync() {
    if (!fs.existsSync(this.opts.hashFile)) {
      await this.createHashFile();
    }

    const hashes = await this.loadHashFile();
    const directory = path.resolve(this.opts.directory);

    const localFiles = (await this.getLocalFiles(this.opts.directory))
      .map((file) => {
        return { key: path.relative(directory, file.key), hash: file.hash };
      })
      .filter((file) => this.isFileIncluded(file.key));
    const filteredLocalFiles = localFiles.filter((file) => {
      return (
        !(file.key in hashes) ||
        hashes[file.key] === null ||
        hashes[file.key] !== file.hash
      );
    });
    await this.uploadFiles(filteredLocalFiles);
    await this.updateHashFile(localFiles);

    if (this.opts.purge) {
      await this.purgeStaleFiles(localFiles.map((file) => file.key));
    }
  }

  private isFileIncluded(file: string): boolean {
    return !this.includeRegex || this.includeRegex.test(file);
  }

  private async getSubsetOfFiles(
    Marker?: string
  ): Promise<AWS.S3.ListObjectsOutput> {
    return new Promise((resolve, reject) => {
      this.s3.listObjects({ Bucket: this.opts.bucket, Marker }, (err, data) => {
        if (err) {
          reject(
            new S3Error(`Couldn't list objects in bucket: ${err.message}`)
          );
        } else {
          resolve(data);
        }
      });
    });
  }

  private async getAllFiles(): Promise<string[]> {
    let startAfter: string | undefined = undefined;
    let isTruncated = false;

    const allKeys = [];
    do {
      const results: AWS.S3.ListObjectsOutput = await this.getSubsetOfFiles(
        startAfter
      );
      isTruncated = !!results.IsTruncated;
      if (results.Contents?.length) {
        startAfter = results.Contents[results.Contents.length - 1].Key;
        allKeys.push(...results.Contents.map((object) => object.Key as string));
      } else {
        break;
      }
    } while (isTruncated);

    return allKeys.filter(this.isFileIncluded.bind(this));
  }

  private async purgeStaleFiles(keysToKeep: string[]) {
    const allKeys = await this.getAllFiles();
    const keysToDelete: string[] = allKeys.filter(
      (key) => !keysToKeep.includes(key)
    );

    if (!keysToDelete || keysToDelete.length === 0) {
      return Promise.resolve();
    }

    // we chunk into chunks of 1000 because s3.deleteObjects can only
    // delete a maxiumum of 1000 objects at once
    const chunks = keysToDelete.reduce<string[][]>((resultArray, item, idx) => {
      const chunkIndex = Math.floor(idx / 1000);

      if (!resultArray[chunkIndex]) {
        resultArray[chunkIndex] = []; // start a new chunk
      }

      resultArray[chunkIndex].push(item);

      return resultArray;
    }, []);

    const promises = chunks.map(
      (chunkWithKeysToDelete) =>
        new Promise((resolve, reject) => {
          this.s3.deleteObjects(
            {
              Bucket: this.opts.bucket,
              Delete: {
                Objects: chunkWithKeysToDelete.map((key) => {
                  return {
                    Key: key,
                  };
                }),
              },
            },
            async (err: AWSError) => {
              if (err) {
                reject(
                  new S3Error(
                    `Couldn't delete stale objects in bucket: ${err.message}`
                  )
                );
              } else {
                resolve();
              }
            }
          );
        })
    );

    console.log(
      keysToDelete
        .map((key) => `${chalk.red.bold('Delete:')} ${key}`)
        .join('\n')
    );
    return Promise.all(promises);
  }

  private async uploadFiles(
    files: { key: string; hash: string }[]
  ): Promise<void[]> {
    try {
      return Promise.all(
        files.map((file) =>
          this.limit(() => this.uploadFile(file.key, file.hash))
        )
      );
    } catch (err) {
      throw new S3Error(err.message);
    }
  }

  private uploadFile(key: string, hash: string): Promise<void> {
    const filePath = path.join(this.opts.directory, key);
    return new Promise((resolve, reject) => {
      const contentType =
        mimetypes.lookup(filePath) || 'application/octet-stream';
      const cacheControl = this.getCacheMaxAge(contentType);
      const stream = fs.createReadStream(filePath);
      this.s3.upload(
        {
          ACL: 'private',
          Bucket: this.opts.bucket,
          Key: key,
          Body: stream,
          CacheControl: cacheControl,
          ContentType: mimetypes.contentType(contentType) || contentType,
          Metadata: {
            hash,
          },
        },
        (err: Error, data: ManagedUpload.SendData) => {
          stream.close();

          if (err) {
            reject(err);
          } else {
            console.log(`${chalk.blue.bold('Upload:')} ${key}`);
            resolve();
          }
        }
      );
    });
  }

  private getCacheMaxAge(contentType: string): string {
    if (
      contentType.startsWith('text/html') ||
      contentType.startsWith('application/json')
    ) {
      return 'no-cache';
    }

    return 'max-age=31536000';
  }

  private async updateHashFile(
    files: { key: string; hash: string }[]
  ): Promise<void> {
    const hashes: { [key: string]: string | null } = {};

    for (const file of files) {
      hashes[file.key] = file.hash;
    }

    await fs.promises.writeFile(this.opts.hashFile, JSON.stringify(hashes));
  }

  private async createHashFile() {
    const hashes = await new Promise((resolve, reject) => {
      this.s3.listObjects({ Bucket: this.opts.bucket }, async (err, data) => {
        if (err) {
          reject(
            new S3Error(`Couldn't list objects in bucket: ${err.message}`)
          );
        } else if (data.Contents) {
          const hashes: { [key: string]: string | null } = {};
          for (const key of data.Contents.map(
            (object) => object.Key as string
          )) {
            hashes[key] = await this.getHashForKey(key);
          }

          resolve(hashes);
        }
      });
    });
    await fs.promises.writeFile(this.opts.hashFile, JSON.stringify(hashes));
  }

  private async loadHashFile(): Promise<{ [key: string]: string }> {
    const buffer = await fs.promises.readFile(this.opts.hashFile);

    try {
      return JSON.parse(buffer.toString());
    } catch (err) {
      return {};
    }
  }

  private async getHashForKey(key: string): Promise<string | null> {
    return new Promise((resolve, reject) => {
      this.s3.headObject(
        { Bucket: this.opts.bucket, Key: key as string },
        async (err, data) => {
          if (err) {
            reject(
              new S3Error(
                `Couldn't get hash of object with key ${key}: ${err.message}`
              )
            );
          } else {
            if (data.Metadata && data.Metadata.hash) {
              resolve(data.Metadata.hash);
            } else {
              resolve(null);
            }
          }
        }
      );
    });
  }

  private async getLocalFiles(
    directory: string
  ): Promise<{ key: string; hash: string }[]> {
    const subdirs = await this.limit(() => fs.promises.readdir(directory));
    const files = await Promise.all(
      subdirs.map(async (subdirectory: string) => {
        const res = path.resolve(directory, subdirectory);
        return (await this.limit(() => fs.promises.stat(res))).isDirectory()
          ? this.getLocalFiles(res)
          : {
              key: res,
              hash: await this.limit(() => this.getHashOfLocalFile(res)),
            };
      })
    );
    return Array.prototype.concat(...files);
  }

  private async getHashOfLocalFile(file: string): Promise<string> {
    return new Promise((resolve) => {
      const hash = crypto.createHash('sha256');
      hash.setEncoding('hex');
      const input = fs.createReadStream(file);

      input.on('end', () => {
        hash.end();
        resolve(hash.read());
        input.close();
      });

      input.pipe(hash);
    });
  }
}
