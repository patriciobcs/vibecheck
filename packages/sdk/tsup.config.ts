import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    target: "es2020",
  },
  {
    // Script-tag build: <script src="vibecheck.js" data-key="..."></script>
    entry: { vibecheck: "src/script.ts" },
    format: ["iife"],
    globalName: "VibeCheck",
    minify: true,
    sourcemap: true,
    target: "es2020",
  },
]);
