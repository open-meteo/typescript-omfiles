# Changelog

## [0.0.13](https://github.com/open-meteo/typescript-omfiles/compare/v0.0.12...v0.0.13) (2025-10-31)


### Bug Fixes

* asCachedReader needs to wait for fetchMetadata ([c39b687](https://github.com/open-meteo/typescript-omfiles/commit/c39b687613076cdda0abb9d3b293c35071501286))
* readme ([1210742](https://github.com/open-meteo/typescript-omfiles/commit/121074255ad35aaf80eec397f153f36ff7b458ea))

## [0.0.12](https://github.com/open-meteo/typescript-omfiles/compare/v0.0.11...v0.0.12) (2025-10-14)


### Features

* improve tests and generics for read array ([#47](https://github.com/open-meteo/typescript-omfiles/issues/47)) ([ce78f2d](https://github.com/open-meteo/typescript-omfiles/commit/ce78f2d61207d1994853193be4994802ea91f2ad))
* support reading into sab ([#49](https://github.com/open-meteo/typescript-omfiles/issues/49)) ([96efed8](https://github.com/open-meteo/typescript-omfiles/commit/96efed820b9df64c5e4124d24e1e7590a8a15852))


### Bug Fixes

* support for missing scalar data types ([#50](https://github.com/open-meteo/typescript-omfiles/issues/50)) ([5db66cf](https://github.com/open-meteo/typescript-omfiles/commit/5db66cfd6a34632469a94f8e255f2e39bfe255d5))

## [0.0.11](https://github.com/open-meteo/typescript-omfiles/compare/v0.0.10...v0.0.11) (2025-08-30)


### Bug Fixes

* first read trailer, then fallback to header based approach ([#43](https://github.com/open-meteo/typescript-omfiles/issues/43)) ([93e6ffd](https://github.com/open-meteo/typescript-omfiles/commit/93e6ffd9d3b92f2869abaeb286ee0d3dfede3881))

## [0.0.10](https://github.com/open-meteo/typescript-omfiles/compare/v0.0.9...v0.0.10) (2025-08-28)


### Features

* add avx flag ([6189f7b](https://github.com/open-meteo/typescript-omfiles/commit/6189f7b3c3792baf9fcec42b5a2f4a9a5538d590))
* add option to disable etag validation ([#42](https://github.com/open-meteo/typescript-omfiles/issues/42)) ([fad805c](https://github.com/open-meteo/typescript-omfiles/commit/fad805cb5f6e122caab424296871c7e6cf9d80da))

## [0.0.9](https://github.com/open-meteo/typescript-omfiles/compare/v0.0.8...v0.0.9) (2025-08-10)


### Features

* initialize reader by child name ([#39](https://github.com/open-meteo/typescript-omfiles/issues/39)) ([6fe65b3](https://github.com/open-meteo/typescript-omfiles/commit/6fe65b3ad1d68addef81b79aa1891dc989acf269))

## [0.0.8](https://github.com/open-meteo/typescript-omfiles/compare/v0.0.7...v0.0.8) (2025-07-31)


### Bug Fixes

* improve build flags and minor fixes in decoder ([#36](https://github.com/open-meteo/typescript-omfiles/issues/36)) ([a60e50a](https://github.com/open-meteo/typescript-omfiles/commit/a60e50a89ed8cb08b9f4023af169f29fd6967f6d))

## [0.0.7](https://github.com/open-meteo/typescript-omfiles/compare/v0.0.6...v0.0.7) (2025-07-30)


### Features

* block cache backend ([#34](https://github.com/open-meteo/typescript-omfiles/issues/34)) ([476a012](https://github.com/open-meteo/typescript-omfiles/commit/476a012c8bbd669098f7fcfa0bdfbbe516991697))


### Bug Fixes

* error during decoder init ([#35](https://github.com/open-meteo/typescript-omfiles/issues/35)) ([889c978](https://github.com/open-meteo/typescript-omfiles/commit/889c9786112da8566cbefa0107dd509c771ba159))
* inconsistencies in README ([a57b206](https://github.com/open-meteo/typescript-omfiles/commit/a57b206d2fb07d6d54bf0fabda77b0953907009f))
* more inconsistencies in README ([9653487](https://github.com/open-meteo/typescript-omfiles/commit/96534870d86a88a67bc3915da9cc06747f480e21))

## [0.0.6](https://github.com/open-meteo/typescript-omfiles/compare/v0.0.5...v0.0.6) (2025-06-15)


### Features

* export S3Backend ([a97a2af](https://github.com/open-meteo/typescript-omfiles/commit/a97a2afcfe30f094c6e17b823617366c77e20036))
* publish to npm via github actions ([#7](https://github.com/open-meteo/typescript-omfiles/issues/7)) ([7ef583d](https://github.com/open-meteo/typescript-omfiles/commit/7ef583d700908b9a9c91638c912e9fa454c6751b))
* restructure into two packages ([#6](https://github.com/open-meteo/typescript-omfiles/issues/6)) ([8e1a483](https://github.com/open-meteo/typescript-omfiles/commit/8e1a483dcbc8a830d1cc770d30a1a3a53ad778a3))


### Bug Fixes

* add missing .release-please-manifest.json ([e946af1](https://github.com/open-meteo/typescript-omfiles/commit/e946af11374d51ef3efd823b1e7190333097d1a8))
* Add verbose flag ([f88d7db](https://github.com/open-meteo/typescript-omfiles/commit/f88d7db88bd02db119fee884e3e667278f3aa41a))
* broken example in README.md ([477fc5e](https://github.com/open-meteo/typescript-omfiles/commit/477fc5e01f7eb22b7125ad8124eaeb69227b7321))
* improve esm and cjs modules ([#11](https://github.com/open-meteo/typescript-omfiles/issues/11)) ([8e90da9](https://github.com/open-meteo/typescript-omfiles/commit/8e90da9f4d8dcc1ecc2ddd37c3ac24b8b286e501))
* Module warnings ([#25](https://github.com/open-meteo/typescript-omfiles/issues/25)) ([83ad124](https://github.com/open-meteo/typescript-omfiles/commit/83ad12446c83e24e6a86f580c463787d5cab3b33))
* PR title and merged CHANGELOG.md path for release-please ([894583f](https://github.com/open-meteo/typescript-omfiles/commit/894583f742fd4a17ae780a72acfbab00569293b5))
* README.md formatting ([cb21094](https://github.com/open-meteo/typescript-omfiles/commit/cb21094b1a83d73d147907a4767a016b9cd5315e))
* release-please does not use node-workspace but extra-files instead ([d130b9c](https://github.com/open-meteo/typescript-omfiles/commit/d130b9c3699beab0e650515e9f68dcd02f2605d3))
* release-please node-workspace setup ([#13](https://github.com/open-meteo/typescript-omfiles/issues/13)) ([3a12ffc](https://github.com/open-meteo/typescript-omfiles/commit/3a12ffcb195cc8e1c0fae66ab8dc3f763674ae79))
* remove unknown option monorepo-tags ([ff08120](https://github.com/open-meteo/typescript-omfiles/commit/ff08120334c8f3d61eea6ce197a5b8d9da9350f7))
* single CHANGELOG.md file for all workspace packages ([84e5d3d](https://github.com/open-meteo/typescript-omfiles/commit/84e5d3d8edb5f1d11a73f46828b62679fc3e5871))
* unknown option in release-please-config.json ([1a04269](https://github.com/open-meteo/typescript-omfiles/commit/1a042693940fe6c9cdf30de03a5e9a6b53065952))
* warning about missing source files ([#27](https://github.com/open-meteo/typescript-omfiles/issues/27)) ([dd97161](https://github.com/open-meteo/typescript-omfiles/commit/dd971613b649f0237e30aa4e73aabc43b5d929fd))


### Reverts

* remove broken S3Backend for now ([#18](https://github.com/open-meteo/typescript-omfiles/issues/18)) ([0f5f56b](https://github.com/open-meteo/typescript-omfiles/commit/0f5f56b0ccae663383d26adb9d267747ce3bdac3))

## [0.0.5](https://github.com/open-meteo/typescript-omfiles/compare/omfiles-v0.0.4...omfiles-v0.0.5) (2025-05-23)


### Bug Fixes

* Add verbose flag ([f88d7db](https://github.com/open-meteo/typescript-omfiles/commit/f88d7db88bd02db119fee884e3e667278f3aa41a))

## [0.0.4](https://github.com/open-meteo/typescript-omfiles/compare/omfiles-v0.0.3...omfiles-v0.0.4) (2025-05-21)


### Bug Fixes

* broken example in README.md ([477fc5e](https://github.com/open-meteo/typescript-omfiles/commit/477fc5e01f7eb22b7125ad8124eaeb69227b7321))


### Reverts

* remove broken S3Backend for now ([#18](https://github.com/open-meteo/typescript-omfiles/issues/18)) ([0f5f56b](https://github.com/open-meteo/typescript-omfiles/commit/0f5f56b0ccae663383d26adb9d267747ce3bdac3))

## [0.0.3](https://github.com/open-meteo/typescript-omfiles/compare/omfiles-v0.0.2...omfiles-v0.0.3) (2025-05-21)


### Features

* export S3Backend ([a97a2af](https://github.com/open-meteo/typescript-omfiles/commit/a97a2afcfe30f094c6e17b823617366c77e20036))
* publish to npm via github actions ([#7](https://github.com/open-meteo/typescript-omfiles/issues/7)) ([7ef583d](https://github.com/open-meteo/typescript-omfiles/commit/7ef583d700908b9a9c91638c912e9fa454c6751b))
* restructure into two packages ([#6](https://github.com/open-meteo/typescript-omfiles/issues/6)) ([8e1a483](https://github.com/open-meteo/typescript-omfiles/commit/8e1a483dcbc8a830d1cc770d30a1a3a53ad778a3))


### Bug Fixes

* add missing .release-please-manifest.json ([e946af1](https://github.com/open-meteo/typescript-omfiles/commit/e946af11374d51ef3efd823b1e7190333097d1a8))
* improve esm and cjs modules ([#11](https://github.com/open-meteo/typescript-omfiles/issues/11)) ([8e90da9](https://github.com/open-meteo/typescript-omfiles/commit/8e90da9f4d8dcc1ecc2ddd37c3ac24b8b286e501))
* PR title and merged CHANGELOG.md path for release-please ([894583f](https://github.com/open-meteo/typescript-omfiles/commit/894583f742fd4a17ae780a72acfbab00569293b5))
* release-please does not use node-workspace but extra-files instead ([d130b9c](https://github.com/open-meteo/typescript-omfiles/commit/d130b9c3699beab0e650515e9f68dcd02f2605d3))
* release-please node-workspace setup ([#13](https://github.com/open-meteo/typescript-omfiles/issues/13)) ([3a12ffc](https://github.com/open-meteo/typescript-omfiles/commit/3a12ffcb195cc8e1c0fae66ab8dc3f763674ae79))
* remove unknown option monorepo-tags ([ff08120](https://github.com/open-meteo/typescript-omfiles/commit/ff08120334c8f3d61eea6ce197a5b8d9da9350f7))
* single CHANGELOG.md file for all workspace packages ([84e5d3d](https://github.com/open-meteo/typescript-omfiles/commit/84e5d3d8edb5f1d11a73f46828b62679fc3e5871))
* unknown option in release-please-config.json ([1a04269](https://github.com/open-meteo/typescript-omfiles/commit/1a042693940fe6c9cdf30de03a5e9a6b53065952))

## Changelog

All notable changes to this project will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) and [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).
