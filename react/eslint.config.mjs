import baseConfig from "../tooling/eslint.base.mjs";
import tsParser from "@typescript-eslint/parser";

export default [
  ...baseConfig,
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "e2e/**",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-console": ["error", { allow: ["warn"] }],
    },
  },
];
