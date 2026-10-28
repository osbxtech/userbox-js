import baseConfig from "../tooling/eslint.base.mjs";
import tsParser from "@typescript-eslint/parser";

export default [
  ...baseConfig,
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
    ],
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
  },
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-console": "error",
    },
  },
];
