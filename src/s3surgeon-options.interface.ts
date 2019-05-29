export interface S3SurgeonOptions {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucket: string;
  directory: string;
  hashFile: string;
  purge: boolean;
}
