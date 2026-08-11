import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const evalRoot = path.join(repoRoot, "packages/evals");

export default defineConfig({
  root: evalRoot,
  test: {
    include: ["examples/**/*.eval.ts", "tests/**/*.test.ts"],
    setupFiles: [path.join(evalRoot, "setup.ts")],
    testTimeout: 120_000,
  },
  resolve: {
    alias: [
      {
        find: "@moontide/evals",
        replacement: path.join(evalRoot, "src/index.ts"),
      },
      {
        find: "@moontide/run-protocol",
        replacement: path.join(repoRoot, "packages/run-protocol/src/index.ts"),
      },
      {
        find: "@moontide/agent/testing",
        replacement: path.join(repoRoot, "packages/agent/src/testing/index.ts"),
      },
      {
        find: "@moontide/agent/load-env",
        replacement: path.join(repoRoot, "packages/agent/src/app/load-env.ts"),
      },
      {
        find: "@moontide/agent",
        replacement: path.join(repoRoot, "packages/agent/src/index.ts"),
      },
      {
        find: "@moontide/agent-core",
        replacement: path.join(repoRoot, "packages/agent-core/src/index.ts"),
      },
      {
        find: /^@moontide\/shared\/(.+)\.js$/,
        replacement: path.join(repoRoot, "packages/shared/src") + "/$1",
      },
      {
        find: "@moontide/shared",
        replacement: path.join(repoRoot, "packages/shared/src/index.ts"),
      },
      {
        find: "@moontide/llm/protocol",
        replacement: path.join(repoRoot, "packages/llm/src/protocol/index.ts"),
      },
      {
        find: "@moontide/llm/models",
        replacement: path.join(repoRoot, "packages/llm/src/models/index.ts"),
      },
      {
        find: "@moontide/llm",
        replacement: path.join(repoRoot, "packages/llm/src/index.ts"),
      },
      {
        find: "@moontide/session/stores",
        replacement: path.join(repoRoot, "packages/session/src/stores/index.ts"),
      },
      {
        find: "@moontide/session/block-registry",
        replacement: path.join(repoRoot, "packages/session/src/block-registry.ts"),
      },
      {
        find: "@moontide/session",
        replacement: path.join(repoRoot, "packages/session/src/index.ts"),
      },
      {
        find: "@moontide/context-composer/ports",
        replacement: path.join(repoRoot, "packages/context-composer/src/ports/index.ts"),
      },
      {
        find: "@moontide/context-composer/budget",
        replacement: path.join(repoRoot, "packages/context-composer/src/budget/index.ts"),
      },
      {
        find: "@moontide/context-composer/compaction",
        replacement: path.join(repoRoot, "packages/context-composer/src/compaction/operations.ts"),
      },
      {
        find: "@moontide/context-composer",
        replacement: path.join(repoRoot, "packages/context-composer/src/index.ts"),
      },
      {
        find: "@moontide/log",
        replacement: path.join(repoRoot, "packages/log/src/index.ts"),
      },
      {
        find: "@moontide/tools/ports",
        replacement: path.join(repoRoot, "packages/tools/src/ports/index.ts"),
      },
      {
        find: "@moontide/tools/builtins/workspace/fs",
        replacement: path.join(repoRoot, "packages/tools/src/builtins/workspace/fs.ts"),
      },
      {
        find: "@moontide/tools",
        replacement: path.join(repoRoot, "packages/tools/src/index.ts"),
      },
      {
        find: "@moontide/plugins-sdk",
        replacement: path.join(repoRoot, "packages/plugins-sdk/src/index.ts"),
      },
      {
        find: "@moontide/sidecar-host/ports",
        replacement: path.join(repoRoot, "packages/sidecar-host/src/ports/index.ts"),
      },
      {
        find: "@moontide/sidecar-host",
        replacement: path.join(repoRoot, "packages/sidecar-host/src/index.ts"),
      },
    ],
  },
});
