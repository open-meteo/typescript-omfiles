#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Get the root package.json version
const rootPkg = require('../package.json');
const version = rootPkg.version;

// Update each workspace package
const workspaces = ['packages/file-format-wasm', 'packages/file-reader'];

workspaces.forEach(workspace => {
  const pkgPath = path.join(__dirname, '..', workspace, 'package.json');
  const pkg = require(pkgPath);

  // Update version
  pkg.version = version;

  // Write the file back
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

  console.log(`Updated ${workspace} to version ${version}`);
});
