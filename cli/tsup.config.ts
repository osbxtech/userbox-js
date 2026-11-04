import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/bin.ts"],
  format: ["esm"],
  clean: true,
  sourcemap: true,
  target: "node20",
  splitting: false,
  outDir: "dist",
  banner: { js: "#!/usr/bin/env node" },
});
