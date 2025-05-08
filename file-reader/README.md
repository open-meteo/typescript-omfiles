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

## Building from Source

### Prerequisites

- Node.js 16+
- NPM or Yarn

### Build Steps

```bash
# Install dependencies
npm install

# Build the library
npm run build

# Run tests
npm test
```

## Contributing

Contributions are welcome! Please feel free to open an Issue or to submit a Pull Request.

## License

This code depends on [TurboPFor](https://github.com/powturbo/TurboPFor-Integer-Compression) and [open-meteo](https://github.com/open-meteo/open-meteo) code; their license restrictions apply.
