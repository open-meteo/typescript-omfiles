import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Decoding relies on `@openmeteo/file-format-wasm`, whose dist is only built
// (Docker + emscripten) in CI. To allow unit tests that do not exercise the wasm
// (HTTP backends: HEAD/Range), alias it to a stub *only* when its dist is missing —
// CI (with the wasm built) keeps the real module.
const wasmDist = fileURLToPath(
  new URL("../file-format-wasm/dist/om_reader_wasm.node.js", import.meta.url)
);
const wasmStub = fileURLToPath(new URL("./src/tests/wasm-stub.ts", import.meta.url));

export default defineConfig({
  resolve: {
    alias: existsSync(wasmDist) ? {} : { "@openmeteo/file-format-wasm": wasmStub },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/tests/**"],
    },
  },
});
