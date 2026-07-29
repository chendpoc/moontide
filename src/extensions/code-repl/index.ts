import { codeReplDisabled } from "../../config.js";
import type { ToolDefinition } from "../../toolkit/types.js";
import { buildRuntimeEnum, runtimeDescriptions } from "./registry.js";
import { executeCodeRepl } from "./executor.js";
import { registerBuiltinRuntimes } from "./runtimes/index.js";

function buildCodeReplSchema() {
  const runtimeEnum = buildRuntimeEnum();
  return {
    name: "code_repl",
    description: `Execute code in the workspace via a pluggable runtime.\n\nRuntimes:\n${runtimeDescriptions()}\n\nReturns JSON with exit_code, stdout, stderr, duration_ms, executed_path.`,
    input_schema: {
      type: "object" as const,
      properties: {
        runtime: {
          type: "string",
          enum: runtimeEnum,
          description: "Execution runtime (default from OCULEAU_CODE_REPL_DEFAULT_RUNTIME).",
        },
        code: {
          type: "string",
          description: "Inline source code (use with or without path).",
        },
        path: {
          type: "string",
          description: "Workspace-relative script path.",
        },
        args: {
          type: "array",
          items: { type: "string" },
          description: "CLI arguments passed to the script.",
        },
        timeout_ms: {
          type: "integer",
          description: "Execution timeout in milliseconds.",
        },
        persist: {
          type: "boolean",
          description: "When true with inline code, write to path instead of a temp file.",
        },
      },
    },
  };
}

export function defineCodeReplTool(): ToolDefinition | null {
  if (codeReplDisabled()) {
    return null;
  }

  registerBuiltinRuntimes();

  return {
    schema: buildCodeReplSchema(),
    handler: (input, _ctx) => executeCodeRepl(input as Parameters<typeof executeCodeRepl>[0]),
  };
}

export { executeCodeRepl } from "./executor.js";
export { probeAll } from "./registry.js";
