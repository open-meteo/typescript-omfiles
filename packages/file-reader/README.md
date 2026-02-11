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

Usage depends on the backend you want to use to access the data and the environment you are in (Node, Browser). Expect this to be improved in the future!

### Browser: Reading from a File Input

```typescript
import { OmFileReader, FileBackend, OmDataType } from "@openmeteo/file-reader";

// Assume you have a <input type="file" id="fileInput" />
const fileInput = document.getElementById("fileInput");
fileInput.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  const backend = new FileBackend(file);
  const reader = await OmFileReader.create(backend);

  // this selects all data of all dimensions
  // If the array you are reading is too big, this might result in OOM
  const readRanges = reader.getDimensions().map((dim) => {
    return {
      start: 0,
      end: dim,
    };
  });

  const data = await reader.read({type: OmDataType.FloatArray, ranges: readRanges});
  console.log(data);
});
```

### Browser: Partial access over HTTP backed by a BlockCache

```typescript
import { OmHttpBackend, BrowserBlockCache, OmDataType } from "@openmeteo/file-reader";

// Create a BrowserBlockCache (defaults: 64KB blocks, 1GB persistent cache)
const cache = new BrowserBlockCache({
  cacheName: "my-om-cache",
  blockSize: 64 * 1024,
  memCacheTtlMs: 2_000, // keep blocks in memory for 2s
  maxBytes: 200 * 1024 * 1024, // 200MB persistent limit
  evictionFraction: 0.15,
  maxConcurrentFetches: 6,
});

const httpBackend = new OmHttpBackend({ url: "https://example.com/data.om" });

// Create an OmFileReader backed by the block cache.
// The URL will be part of the cache-key. If the data behind this url changes, the BrowserBlockCache is currently not suitable!
const reader = await httpBackend.asCachedReader(cache);

// Use the reader like normal; blocks will be read from the browser cache where possible.
const dims = reader.getDimensions();
const ranges = dims.map((dim) => ({ start: 0, end: dim }));
const arr = await reader.read({ type: OmDataType.FloatArray, ranges });
console.log(arr);
```

### Node.js: Reading from a Local File

```typescript
import { OmFileReader, FileBackend, OmDataType } from "@openmeteo/file-reader";

const backend = new FileBackend("/path/to/your/file.om");
const reader = await OmFileReader.create(backend);
// this selects all data of all dimensions
// If the array you are reading is too big, this might result in OOM
const readRanges = reader.getDimensions().map((dim) => {
  return {
    start: 0,
    end: dim,
  };
});

const data = await reader.read({type: OmDataType.FloatArray, ranges: readRanges});
console.log(data);
```



### In-Memory Data

```typescript
const buffer = new Uint8Array([...]); // Your OmFile data
const backend = new FileBackend(buffer);
const reader = await OmFileReader.create(backend);
```

## License

This code depends on [TurboPFor](https://github.com/powturbo/TurboPFor-Integer-Compression) and [open-meteo](https://github.com/open-meteo/open-meteo) code; their license restrictions apply.
