#!/usr/bin/env node

import { program } from 'commander';
import { S3Error } from './s3.error.js';
import { S3Surgeon } from './s3surgeon.js';

program
  .version('2.1.4', '-v, --version')
  .option('-k, --access-key-id <access-key-id>', 'AWS Access Key ID')
  .option(
    '-s, --secret-access-key <secret-access-key>',
    'AWS Secret Access Key'
  )
  .option('-r, --region <region>', 'AWS Region', 'eu-central-1')
  .option('-e, --endpoint <endpoint>', 'S3 Endpoint', '')
  .option('-b, --bucket <bucket>', 'Bucket ARN')
  .option('-d, --directory <directory>', 'Directory to sync', '.')
  .option('-f, --force-path-style', 'Force path style')
  .option('-g, --signature-version <2|3|4>', 'Set signature version', '4')
  .option(
    '-i, --include <regex>',
    'Only consider files for uploading and deletion if the match the regex'
  )
  .option('-P, --no-purge', "Keep files in the bucket that don't exist locally")
  .option(
    '-H, --hash-file <hash-file>',
    'File containing hash cache',
    's3-hashes.json'
  )
  .parse(process.argv);

['accessKeyId', 'secretAccessKey', 'bucket'].forEach((option) => {
  if (!program.getOptionValue(option)) {
    program.outputHelp(() => program.help());
    process.exit(1);
  }
});

const options = [
  'accessKeyId',
  'secretAccessKey',
  'bucket',
  'region',
  'directory',
  'hashFile',
  'endpoint',
  'include',
].reduce(
  (result, option) => (
    (result[option] = program.getOptionValue(option) as string), result
  ),
  {} as any
);

options.forcePathStyle = program.getOptionValue('forcePathStyle');
options.signatureVersion = program.getOptionValue('signatureVersion');
options.purge = program.getOptionValue('purge');

// In case of default options make sure that s3-hashes.json isn't uploaded on subsequent runs
if (options.directory === '.' && options.hashFile === 's3-hashes.json') {
  options.hashFile = `../${options.hashFile}`;
}

const s3surgeon = new S3Surgeon(options);

s3surgeon.sync().catch((err) => {
  if (err instanceof S3Error) {
    console.error(`There was a problem talking to S3: ${err.message ?? err}`);
  } else {
    console.error(`Syncing failed: ${err.message ?? err}`);
  }

  process.exit(1);
});
