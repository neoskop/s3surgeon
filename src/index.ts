#!/usr/bin/env node

import program from "commander";
import { S3Surgeon } from "./s3surgeon";

program
  .version("0.0.1", "-v, --version")
  .option("-k --access-key-id <access-key-id>", "AWS Access Key ID")
  .option("-s --secret-access-key <secret-access-key>", "AWS Secret Access Key")
  .option("-r --region <region>", "AWS Region", "eu-central-1")
  .option("-b, --bucket <bucket>", "Bucket ARN")
  .option("-d, --directory <directory>", "Directory to sync", ".")
  .option(
    "-h, --hash-file <hash-file>",
    "File containing hash cache",
    "s3-hashes.json"
  )
  .parse(process.argv);

["accessKeyId", "secretAccessKey", "bucket"].forEach(option => {
  if (!program.hasOwnProperty(option)) {
    program.outputHelp(() => program.help());
    process.exit(1);
  }
});

const options = [
  "accessKeyId",
  "secretAccessKey",
  "bucket",
  "region",
  "directory",
  "hashFile"
].reduce(
  (result, option) => ((result[option] = program[option] as string), result),
  {} as any
);
const s3surgeon = new S3Surgeon(options);
s3surgeon.sync();
