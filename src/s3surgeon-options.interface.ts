export interface S3SurgeonOptions {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucket: string;
  directory: string;
  hashFile: string;
  signatureVersion: number;
  endpoint?: string;
  forcePathStyle: boolean;
  purge: boolean;
}
