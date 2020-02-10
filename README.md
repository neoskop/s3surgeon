# s3surgeon

Sync your files to [AWS S3][1] with surgical precision.

## Overview

When using `aws s3 sync` to synchronize local files with a S3 bucket, the CLI will only compare file sizes and timestamps. `s3surgeon` instead only compares the respective file hashes.

## Quickstart

Install the CLI by installing the NPM package `s3surgeon` as a global dependency:

```bash
$ npm i -g s3surgeon
```

You can sync all files from the current directory to an S3 bucket like so:

```bash
$ s3surgeon \
    --access-key-id <access-key-id> \
    --secret-access-key <secret-access-key>
    --bucket <bucket-name>
Upload: foo.txt
Upload: foo/bar.bar
```

For a complete reference of available switches and options run:

```bash
$ s3surgeon -h
```

## Non-AWS-Usage

For an example on how to use `s3surgeon` with MinIO instead of AWS S3 see `docker-compose.yml`

## License

This project is under the terms of the Apache License, Version 2.0. A copy of this license is included with the sources.

[1]: https://aws.amazon.com/de/s3/
