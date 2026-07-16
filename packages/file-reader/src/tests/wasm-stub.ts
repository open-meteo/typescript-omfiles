// Stub for the wasm module, used by unit tests that do not exercise decoding
// (HTTP backends: HEAD/Range). See vitest.config.ts: aliased in place of
// `@openmeteo/file-format-wasm` only when its dist has not been built.
export default () => Promise.resolve({});
