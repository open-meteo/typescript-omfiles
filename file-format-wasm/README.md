# file-format-wasm

WebAssembly bindings for the [Open-Meteo File Format](https://github.com/open-meteo/om-file-format/).

## Overview

This package provides WebAssembly bindings to the OmFileFormat C library, enabling efficient reading of OmFile data in web browsers and Node.js environments. It is designed to be used by the `omfiles-js` package, but can also be used independently.

## Features

- Direct WebAssembly bindings to the C implementation of OmFileFormat
- High-performance data access
- ES module format
- Browser and Node.js compatibility

## Installation

```bash
npm install @openmeteo/file-format-wasm
```

## Usage

```javascript
import { OmFileFormat } from '@openmeteo/file-format-wasm';

// Initialize the WASM module
const module = await OmFileFormat.default();

// Use the raw WASM functions
const headerSize = module._om_header_size();
```

## Building from Source

### Prerequisites

- Docker (for building the WebAssembly component)

### Build Steps

```bash
# Clone the repository
git clone --recursive https://github.com/open-meteo/typescript-omfiles.git
cd typescript-omfiles

# Build using Docker
docker pull emscripten/emsdk
npm run build:wasm
```

## License

This code depends on [TurboPFor](https://github.com/powturbo/TurboPFor-Integer-Compression) and [open-meteo](https://github.com/open-meteo/open-meteo) code; their license restrictions apply.
