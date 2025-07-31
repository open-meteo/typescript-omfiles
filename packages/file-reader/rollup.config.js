import typescript from "@rollup/plugin-typescript";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import terser from "@rollup/plugin-terser";
import dts from "rollup-plugin-dts";
const isProduction = process.env.NODE_ENV === "production";

const commonPlugins = [resolve(), commonjs(), typescript({ tsconfig: "./tsconfig.json" }), isProduction && terser()];

export default [
  // Browser ESM
  {
    input: "src/index.browser.ts",
    output: {
      file: "dist/esm/index.browser.js",
      format: "esm",
      sourcemap: true,
      inlineDynamicImports: true,
    },
    external: ["@openmeteo/file-format-wasm", "@aws-sdk/client-s3"],
    plugins: commonPlugins,
  },
  // Node ESM
  {
    input: "src/index.node.ts",
    output: {
      file: "dist/esm/index.js",
      format: "esm",
      sourcemap: true,
      inlineDynamicImports: true,
    },
    external: ["@openmeteo/file-format-wasm", "@aws-sdk/client-s3"],
    plugins: commonPlugins,
  },
  // Browser CJS
  {
    input: "src/index.browser.ts",
    output: {
      file: "dist/cjs/index.browser.cjs",
      format: "cjs",
      sourcemap: true,
      inlineDynamicImports: true,
    },
    external: ["@openmeteo/file-format-wasm", "@aws-sdk/client-s3"],
    plugins: commonPlugins,
  },
  // Node CJS
  {
    input: "src/index.node.ts",
    output: {
      file: "dist/cjs/index.cjs",
      format: "cjs",
      sourcemap: true,
      inlineDynamicImports: true,
    },
    external: ["@openmeteo/file-format-wasm", "@aws-sdk/client-s3"],
    plugins: commonPlugins,
  },
  // Type definitions (optional: you may want to generate for both entrypoints)
  {
    input: "src/index.node.ts",
    output: { file: "dist/index.d.ts", format: "es" },
    plugins: [dts()],
  },
];
