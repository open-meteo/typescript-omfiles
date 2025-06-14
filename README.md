# Open-Meteo File Format TypeScript/WASM Reader

![Build and Test](https://github.com/open-meteo/typescript-omfiles/actions/workflows/build-and-test.yml/badge.svg)
![npm version](https://img.shields.io/npm/v/@openmeteo/file-reader?label=npm%20@openmeteo/file-reader)
![npm version](https://img.shields.io/npm/v/@openmeteo/file-format-wasm?label=npm%20@openmeteo/file-format-wasm)

> **⚠️ Notice:** This package is still under construction and not fully production ready yet. API changes may occur and some features might be incomplete.

## Overview

This project provides JavaScript/TypeScript support for reading and processing OmFile format data efficiently. OmFile format is a scientific data format optimized for meteorological data from the [Open-Meteo](https://github.com/open-meteo/om-file-format/) project.

The repository is structured into two separate packages:

1. **file-format-wasm**: WebAssembly bindings for the OmFileFormat C library
2. **file-reader**: JavaScript/TypeScript API for working with OmFile data

## Features

- Efficient reading of OmFile format data through WebAssembly
- Support for multiple data sources (local files, HTTP, in-memory, S3)
- Browser and Node.js compatibility
- TypeScript support
- High-performance data access

## Installation

```bash
npm install @openmeteo/file-reader
```

## Usage

Usage depends on the backend you want to use to access the data and the environment you are in (Node, Browser). Expect this to be improved in the future!

### Node.js: Reading from a Local File

```typescript
import { OmFileReader, createFileBackend } from '@openmeteo/file-reader';

const backend = await createFileBackend('/path/to/your/file.om');
const reader = await OmFileReader.create(backend);

const data = await reader.readVariable('temperature');
console.log(data);
```

### Browser: Reading from a File Input

```typescript
import { OmFileReader, createFileBackend } from '@openmeteo/file-reader';

// Assume you have a <input type="file" id="fileInput" />
const fileInput = document.getElementById('fileInput');
fileInput.addEventListener('change', async (event) => {
  const file = event.target.files[0];
  const backend = await createFileBackend(file);
  const reader = await OmFileReader.create(backend);

  const data = await reader.readVariable('temperature');
  console.log(data);
});
```

### In-Memory Data

```typescript
const buffer = new Uint8Array([...]); // Your OmFile data
const backend = createFileBackend(buffer);
const reader = await OmFileReader.create(backend);
```

### Remote HTTP File

```typescript
import { MemoryHttpBackend, OmFileReader } from '@openmeteo/file-reader';

const backend = new MemoryHttpBackend({ url: 'https://example.com/data.om' });
const reader = await OmFileReader.create(backend);

## Development

### Prerequisites

- Node.js 16+
- Docker (for building the WebAssembly component)

### Building from Source

```bash
# Clone the repository with submodules
git clone --recursive https://github.com/open-meteo/typescript-omfiles.git

# Install dependencies
npm install
# This will use docker emscripten/emsdk container
# to compile the C code to WASM
npm run build
# Run the tests
npm run test
```

## Contributing

Contributions are welcome! Please feel free to open an Issue or to submit a Pull Request.
