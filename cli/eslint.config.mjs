import baseConfig from "../tooling/eslint.base.mjs";
import tsParser from "@typescript-eslint/parser";

export default [
  ...baseConfig,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module" },
    },
  },
];
