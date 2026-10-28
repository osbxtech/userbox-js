import { defineConfig } from "tsup";

export default defineConfig([
  {
    name: "react-entry",
    entry: { index: "src/index.ts" },
    format: ["esm"],
    dts: true,
    clean: true,
    sourcemap: true,
    target: "es2022",
    splitting: false,
    treeshake: true,
    outDir: "dist",
    external: ["react", "react-dom", "next", "next/server", "next/headers"],
  },
  {
    name: "nextjs-entry",
    entry: { nextjs: "src/nextjs.ts" },
    format: ["esm"],
    dts: true,
    clean: false,
    sourcemap: true,
    target: "es2022",
    splitting: false,
    treeshake: true,
    outDir: "dist",
    external: ["react", "react-dom", "next", "next/server", "next/headers"],
  },
]);
