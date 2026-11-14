import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Each test file opens its own in-memory PGlite. They are independent, but PGlite is a wasm
    // instance per file and running many at once can be slower than running them in order.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
