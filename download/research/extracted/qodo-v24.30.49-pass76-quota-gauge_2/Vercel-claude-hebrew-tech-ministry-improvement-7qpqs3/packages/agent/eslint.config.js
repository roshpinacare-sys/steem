// @ts-check
import js from "@eslint/js";
import ts from "typescript-eslint";

export default [
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-console":        ["warn", { allow: ["warn", "error"] }],
      "@typescript-eslint/no-explicit-any": "error",
      "prefer-const":      "error",
      "no-var":            "error",
      "eqeqeq":            ["error", "always"],
      "no-unused-vars":    "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-shadow":         "off",
      "@typescript-eslint/no-shadow": "error",
      "no-return-await":   "error",
      "require-await":     "off"
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        process:    "readonly",
        console:    "readonly",
        setTimeout: "readonly",
        clearInterval: "readonly",
        setInterval: "readonly",
        fetch:      "readonly",
        Buffer:     "readonly",
        URL:        "readonly",
        AbortSignal:"readonly",
        ReadableStream: "readonly"
      }
    }
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      "no-console": "off"
    }
  }
];
