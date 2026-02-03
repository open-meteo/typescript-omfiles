# Changelog

## [0.0.14](https://github.com/open-meteo/typescript-omfiles/compare/v0.0.13...v0.0.14) (2026-02-03)


### Features

* better cache interface ([#62](https://github.com/open-meteo/typescript-omfiles/issues/62)) ([742ca1f](https://github.com/open-meteo/typescript-omfiles/commit/742ca1f4685471efdb1b04a2d9b6042aa52393b0))


### Bug Fixes

* improve readme and function signature ([61585cb](https://github.com/open-meteo/typescript-omfiles/commit/61585cb6f6386f626ba24768c56639d2640466bf))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @openmeteo/file-format-wasm bumped from ^0.0.13 to ^0.0.14

## [0.0.13](https://github.com/open-meteo/typescript-omfiles/compare/v0.0.12...v0.0.13) (2025-10-31)


### Bug Fixes

* asCachedReader needs to wait for fetchMetadata ([c39b687](https://github.com/open-meteo/typescript-omfiles/commit/c39b687613076cdda0abb9d3b293c35071501286))
* readme ([1210742](https://github.com/open-meteo/typescript-omfiles/commit/121074255ad35aaf80eec397f153f36ff7b458ea))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @openmeteo/file-format-wasm bumped from ^0.0.12 to ^0.0.13

## [0.0.12](https://github.com/open-meteo/typescript-omfiles/compare/v0.0.11...v0.0.12) (2025-10-14)


### Features

* improve tests and generics for read array ([#47](https://github.com/open-meteo/typescript-omfiles/issues/47)) ([ce78f2d](https://github.com/open-meteo/typescript-omfiles/commit/ce78f2d61207d1994853193be4994802ea91f2ad))
* support reading into sab ([#49](https://github.com/open-meteo/typescript-omfiles/issues/49)) ([96efed8](https://github.com/open-meteo/typescript-omfiles/commit/96efed820b9df64c5e4124d24e1e7590a8a15852))


### Bug Fixes

* support for missing scalar data types ([#50](https://github.com/open-meteo/typescript-omfiles/issues/50)) ([5db66cf](https://github.com/open-meteo/typescript-omfiles/commit/5db66cfd6a34632469a94f8e255f2e39bfe255d5))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @openmeteo/file-format-wasm bumped from ^0.0.11 to ^0.0.12

## [0.0.11](https://github.com/open-meteo/typescript-omfiles/compare/v0.0.10...v0.0.11) (2025-08-30)


### Bug Fixes

* first read trailer, then fallback to header based approach ([#43](https://github.com/open-meteo/typescript-omfiles/issues/43)) ([93e6ffd](https://github.com/open-meteo/typescript-omfiles/commit/93e6ffd9d3b92f2869abaeb286ee0d3dfede3881))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @openmeteo/file-format-wasm bumped from ^0.0.10 to ^0.0.11

## [0.0.10](https://github.com/open-meteo/typescript-omfiles/compare/v0.0.9...v0.0.10) (2025-08-28)


### Features

* add option to disable etag validation ([#42](https://github.com/open-meteo/typescript-omfiles/issues/42)) ([fad805c](https://github.com/open-meteo/typescript-omfiles/commit/fad805cb5f6e122caab424296871c7e6cf9d80da))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @openmeteo/file-format-wasm bumped from ^0.0.9 to ^0.0.10

## [0.0.9](https://github.com/open-meteo/typescript-omfiles/compare/v0.0.8...v0.0.9) (2025-08-10)


### Features

* initialize reader by child name ([#39](https://github.com/open-meteo/typescript-omfiles/issues/39)) ([6fe65b3](https://github.com/open-meteo/typescript-omfiles/commit/6fe65b3ad1d68addef81b79aa1891dc989acf269))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @openmeteo/file-format-wasm bumped from ^0.0.8 to ^0.0.9

## [0.0.8](https://github.com/open-meteo/typescript-omfiles/compare/v0.0.7...v0.0.8) (2025-07-31)


### Bug Fixes

* improve build flags and minor fixes in decoder ([#36](https://github.com/open-meteo/typescript-omfiles/issues/36)) ([a60e50a](https://github.com/open-meteo/typescript-omfiles/commit/a60e50a89ed8cb08b9f4023af169f29fd6967f6d))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @openmeteo/file-format-wasm bumped from ^0.0.7 to ^0.0.8

## [0.0.7](https://github.com/open-meteo/typescript-omfiles/compare/v0.0.6...v0.0.7) (2025-07-30)


### Features

* block cache backend ([#34](https://github.com/open-meteo/typescript-omfiles/issues/34)) ([476a012](https://github.com/open-meteo/typescript-omfiles/commit/476a012c8bbd669098f7fcfa0bdfbbe516991697))


### Bug Fixes

* more inconsistencies in README ([9653487](https://github.com/open-meteo/typescript-omfiles/commit/96534870d86a88a67bc3915da9cc06747f480e21))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @openmeteo/file-format-wasm bumped from ^0.0.6 to ^0.0.7

## [0.0.6](https://github.com/open-meteo/typescript-omfiles/compare/v0.0.5...v0.0.6) (2025-06-15)


### Features

* export S3Backend ([a97a2af](https://github.com/open-meteo/typescript-omfiles/commit/a97a2afcfe30f094c6e17b823617366c77e20036))
* publish to npm via github actions ([#7](https://github.com/open-meteo/typescript-omfiles/issues/7)) ([7ef583d](https://github.com/open-meteo/typescript-omfiles/commit/7ef583d700908b9a9c91638c912e9fa454c6751b))


### Bug Fixes

* Add verbose flag ([f88d7db](https://github.com/open-meteo/typescript-omfiles/commit/f88d7db88bd02db119fee884e3e667278f3aa41a))
* improve esm and cjs modules ([#11](https://github.com/open-meteo/typescript-omfiles/issues/11)) ([8e90da9](https://github.com/open-meteo/typescript-omfiles/commit/8e90da9f4d8dcc1ecc2ddd37c3ac24b8b286e501))
* Module warnings ([#25](https://github.com/open-meteo/typescript-omfiles/issues/25)) ([83ad124](https://github.com/open-meteo/typescript-omfiles/commit/83ad12446c83e24e6a86f580c463787d5cab3b33))
* warning about missing source files ([#27](https://github.com/open-meteo/typescript-omfiles/issues/27)) ([dd97161](https://github.com/open-meteo/typescript-omfiles/commit/dd971613b649f0237e30aa4e73aabc43b5d929fd))


### Reverts

* remove broken S3Backend for now ([#18](https://github.com/open-meteo/typescript-omfiles/issues/18)) ([0f5f56b](https://github.com/open-meteo/typescript-omfiles/commit/0f5f56b0ccae663383d26adb9d267747ce3bdac3))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @openmeteo/file-format-wasm bumped from ^0.0.5 to ^0.0.6
