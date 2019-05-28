#!/usr/bin/env node

import program from "commander";
import { S3Error } from "./s3.error";
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

// In case of default options make sure that s3-hashes.json isn't uploaded on subsequent runs
if (options.directory === "." && options.hashFile === "s3-hashes.json") {
  options.hashFile = `../${options.hashFile}`;
}

const s3surgeon = new S3Surgeon(options);

s3surgeon.sync().catch(err => {
  if (err instanceof S3Error) {
    console.error(`There was a problem talking to S3: ${err.message}`);
  } else {
    console.error(`Syncing failed: ${err.message}`);
  }
});
