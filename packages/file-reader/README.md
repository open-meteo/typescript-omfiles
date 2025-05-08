# Open-Meteo File-Reader

JavaScript/TypeScript bindings for the [Open-Meteo File Format](https://github.com/open-meteo/om-file-format/)!

## Overview

This library provides JavaScript/TypeScript bindings to the OmFileFormat C library through WebAssembly. It enables efficient reading of OmFile data in web browsers and Node.js environments.

## Features

- Read OmFile format (scientific data format optimized for meteorological data)
- High-performance data access through WebAssembly
- Multiple backends for different data sources:
  - File backend for local files
  - Memory/HTTP backend for remote files
  - S3 backend for files in AWS S3
- Browser and Node.js compatibility
- TypeScript type definitions included

## Installation

```bash
npm install @openmeteo/file-reader
```

## Usage

```typescript
import { OmFileReader, FileBackend } from '@openmeteo/file-reader';


// Create a reader with a file backend
const backend = new FileBackend('/path/to/your/file.om');
const reader = new OmFileReader.create(backend);

// Get data from a variable
const data = await reader.readVariable('temperature');
console.log(data);
```

## S3 Backend Example

```typescript
import { OmFileReader, S3Backend } from '@openmeteo/file-reader';
import { S3Client } from '@aws-sdk/client-s3';

// Create S3 client
const s3Client = new S3Client({ region: 'us-west-2' });

// Create backend
const backend = new S3Backend(
  s3Client,
  'your-bucket-name',
  'path/to/your/file.om'
);

const reader = new OmFileReader.create(backend);
const data = await reader.readVariable('temperature');
```

## License

This code depends on [TurboPFor](https://github.com/powturbo/TurboPFor-Integer-Compression) and [open-meteo](https://github.com/open-meteo/open-meteo) code; their license restrictions apply.
