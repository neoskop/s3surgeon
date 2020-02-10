export interface S3SurgeonOptions {
  accessKeyId: string;
  bucket: string;
  directory: string;
  endpoint?: string;
  forcePathStyle: boolean;
  hashFile: string;
  include?: string;
  purge: boolean;
  region: string;
  secretAccessKey: string;
  signatureVersion: number;
}
