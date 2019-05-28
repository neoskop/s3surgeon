import * as AWS from "aws-sdk";
import { ManagedUpload } from "aws-sdk/clients/s3";
import crypto from "crypto";
import * as fs from "fs";
import * as mimetypes from "mime-types";
import * as path from "path";
import { promisify } from "util";
import { S3Error } from "./s3.error";
import { S3SurgeonOptions } from "./s3surgeon-options.interface";

export class S3Surgeon {
  private readonly s3: AWS.S3;

  constructor(private readonly opts: S3SurgeonOptions) {
    this.s3 = new AWS.S3({
      accessKeyId: opts.accessKeyId,
      secretAccessKey: opts.secretAccessKey,
      region: opts.region
    });
  }

  public async sync() {
    if (!fs.existsSync(this.opts.hashFile)) {
      await this.createHashFile();
    }

    const hashes = await this.loadHashFile();
    const directory = path.resolve(this.opts.directory);

    const filteredLocalFiles = (await this.getLocalFiles(this.opts.directory))
      .map(file => {
        return { key: path.relative(directory, file.key), hash: file.hash };
      })
      .filter(file => {
        return (
          !(file.key in hashes) ||
          hashes[file.key] === null ||
          hashes[file.key] !== file.hash
        );
      });
    await this.uploadFiles(filteredLocalFiles);
    await this.updateHashFile(hashes, filteredLocalFiles);
  }

  private async uploadFiles(
    files: { key: string; hash: string }[]
  ): Promise<void[]> {
    try {
      return Promise.all(
        files.map(file => this.uploadFile(file.key, file.hash))
      );
    } catch (err) {
      throw new S3Error(err.message);
    }
  }

  private async uploadFile(key: string, hash: string): Promise<void> {
    const filePath = path.join(this.opts.directory, key);
    await new Promise((resolve, reject) => {
      const contentType =
        mimetypes.contentType(filePath) || "application/octet-stream";
      const cacheControl = this.getCacheMaxAge(contentType);
      this.s3.upload(
        {
          ACL: "private",
          Bucket: this.opts.bucket,
          Key: key,
          Body: fs.createReadStream(filePath),
          CacheControl: cacheControl,
          ContentType: contentType,
          Metadata: {
            hash
          }
        },
        (err: Error, data: ManagedUpload.SendData) => {
          if (err) {
            reject(err);
          } else {
            console.log(key);
            resolve(data);
          }
        }
      );
    });
  }

  private getCacheMaxAge(contentType: string): string {
    if (
      contentType.startsWith("text/html") ||
      contentType.startsWith("application/json")
    ) {
      return "no-cache";
    }

    return "max-age=31536000";
  }

  private async updateHashFile(
    existingHashes: { [key: string]: string },
    files: { key: string; hash: string }[]
  ): Promise<void> {
    const hashes: { [key: string]: string | null } = {};

    for (const existingKey of Object.keys(existingHashes)) {
      hashes[existingKey] = existingHashes[existingKey];
    }

    for (const file of files) {
      hashes[file.key] = file.hash;
    }

    await promisify(fs.writeFile)(this.opts.hashFile, JSON.stringify(hashes));
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
          for (const key of data.Contents.map(object => object.Key as string)) {
            hashes[key] = await this.getHashForKey(key);
          }

          resolve(hashes);
        }
      });
    });
    await promisify(fs.writeFile)(this.opts.hashFile, JSON.stringify(hashes));
  }

  private async loadHashFile(): Promise<{ [key: string]: string }> {
    const buffer = await promisify(fs.readFile)(this.opts.hashFile);

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
    const subdirs = await promisify(fs.readdir)(directory);
    const files = await Promise.all(
      subdirs.map(async (subdirectory: string) => {
        const res = path.resolve(directory, subdirectory);
        return (await promisify(fs.stat)(res)).isDirectory()
          ? this.getLocalFiles(res)
          : { key: res, hash: await this.getHashOfLocalFile(res) };
      })
    );
    return Array.prototype.concat(...files);
  }

  private async getHashOfLocalFile(file: string): Promise<string> {
    return new Promise(resolve => {
      const hash = crypto.createHash("sha256");
      const input = fs.createReadStream(file);
      input.on("readable", () => {
        const data = input.read();
        if (data) hash.update(data);
        else {
          resolve(hash.digest("hex"));
        }
      });
    });
  }
}
