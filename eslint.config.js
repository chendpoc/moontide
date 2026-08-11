import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "packages/*/dist/**",
      "apps/*/dist/**",
      "node_modules/**",
      "packages/tools/src/extensions/code-repl/templates/bodies/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.eslint.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["packages/agent-cli/src/**/*.ts", "packages/agent/src/**/*.ts"],
    rules: {
      "@typescript-eslint/naming-convention": [
        "error",
        {
          selector: "function",
          format: ["camelCase"],
          leadingUnderscore: "allow",
        },
        {
          selector: "function",
          modifiers: ["exported"],
          format: ["camelCase"],
          leadingUnderscore: "forbid",
        },
      ],
    },
  },
  {
    files: ["packages/agent-cli/src/**/*.ts", "packages/agent/src/**/*.ts", "tests/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Identifier[name='emitDraft']",
          message: "Renamed to emit(). Import from log/index.js.",
        },
      ],
    },
  },
  {
    files: ["packages/agent-cli/src/**/*.ts", "packages/agent/src/**/*.ts", "tests/**/*.ts"],
    ignores: ["packages/agent-cli/src/log/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/log/event-hub",
                "**/log/event-hub.js",
                "**/log/run",
                "**/log/run.js",
              ],
              message:
                "Import Agent Event API from log/index.js (emit, subscribe, resetRun, …).",
            },
          ],
        },
      ],
    },
  },
);
