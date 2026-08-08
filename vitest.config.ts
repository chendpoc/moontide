import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "packages/*/tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
  },
  resolve: {
    alias: [
      {
        find: "@moontide/agent-common",
        replacement: path.resolve(root, "packages/agent-common/src/index.ts"),
      },
      {
        find: "@moontide/agent-core",
        replacement: path.resolve(root, "packages/agent-core/src/index.ts"),
      },
      {
        find: /^@moontide\/shared\/(.+)\.js$/,
        replacement: path.resolve(root, "packages/shared/src") + "/$1",
      },
      {
        find: "@moontide/shared",
        replacement: path.resolve(root, "packages/shared/src/index.ts"),
      },
      {
        find: "@moontide/llm/protocol",
        replacement: path.resolve(root, "packages/llm/src/protocol/index.ts"),
      },
      {
        find: "@moontide/llm/models",
        replacement: path.resolve(root, "packages/llm/src/models/index.ts"),
      },
      {
        find: "@moontide/llm",
        replacement: path.resolve(root, "packages/llm/src/index.ts"),
      },
      {
        find: "@moontide/session/stores",
        replacement: path.resolve(root, "packages/session/src/stores/index.ts"),
      },
      {
        find: "@moontide/session/block-registry",
        replacement: path.resolve(root, "packages/session/src/block-registry.ts"),
      },
      {
        find: "@moontide/session",
        replacement: path.resolve(root, "packages/session/src/index.ts"),
      },
      {
        find: "@moontide/context-composer/ports",
        replacement: path.resolve(root, "packages/context-composer/src/ports/index.ts"),
      },
      {
        find: "@moontide/context-composer/budget",
        replacement: path.resolve(root, "packages/context-composer/src/budget/index.ts"),
      },
      {
        find: "@moontide/context-composer/compaction",
        replacement: path.resolve(root, "packages/context-composer/src/compaction/operations.ts"),
      },
      {
        find: "@moontide/context-composer",
        replacement: path.resolve(root, "packages/context-composer/src/index.ts"),
      },
      {
        find: "@moontide/log",
        replacement: path.resolve(root, "packages/log/src/index.ts"),
      },
      {
        find: "@moontide/tools/ports",
        replacement: path.resolve(root, "packages/tools/src/ports/index.ts"),
      },
      {
        find: "@moontide/tools/builtins/workspace/fs",
        replacement: path.resolve(root, "packages/tools/src/builtins/workspace/fs.ts"),
      },
      {
        find: "@moontide/tools",
        replacement: path.resolve(root, "packages/tools/src/index.ts"),
      },
      {
        find: "@moontide/plugins-sdk",
        replacement: path.resolve(root, "packages/plugins-sdk/src/index.ts"),
      },
      {
        find: "@moontide/sidecar-host/ports",
        replacement: path.resolve(root, "packages/sidecar-host/src/ports/index.ts"),
      },
      {
        find: "@moontide/sidecar-host",
        replacement: path.resolve(root, "packages/sidecar-host/src/index.ts"),
      },
    ],
  },
});
