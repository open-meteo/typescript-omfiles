import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

export default {
  plugins: [wasm(), topLevelAwait()],
  // Base public path when served
  base: "./",

  // Development server config
  server: {
    port: 3000,
    open: true,
    headers: {
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
    },
  },
  optimizeDeps: {
    exclude: ["omfiles-wasm"],
  },
  build: {
    sourcemap: true,
    assetsInlineLimit: 0,
  },
};
