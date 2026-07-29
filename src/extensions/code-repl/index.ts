import { codeReplDisabled } from "../../config.js";
import type { ToolDefinition } from "../../toolkit/types.js";
import { buildRuntimeEnum, runtimeDescriptions } from "./registry.js";
import { executeCodeRepl } from "./executor.js";
import { registerBuiltinRuntimes } from "./runtimes/index.js";
import { listTemplateIds, templateDescriptions } from "./templates/catalog.js";

function buildCodeReplSchema() {
  const runtimeEnum = buildRuntimeEnum();
  const templateEnum = listTemplateIds();
  return {
    name: "code_repl",
    description: `Execute code in the workspace via a pluggable runtime, or use a named template for common tasks.

Runtimes:
${runtimeDescriptions()}

Templates (prefer over inline code when applicable):
${templateDescriptions()}

Returns JSON with exit_code, stdout, stderr, duration_ms, executed_path. Template runs also include template and resolved_vars.`,
    input_schema: {
      type: "object" as const,
      properties: {
        runtime: {
          type: "string",
          enum: runtimeEnum,
          description: "Execution runtime (default from OCULEAU_CODE_REPL_DEFAULT_RUNTIME). Overridden by template when template is set.",
        },
        template: {
          type: "string",
          enum: templateEnum,
          description: "Named preset script. Mutually exclusive with code and path.",
        },
        vars: {
          type: "object",
          description: "Template variables (see template descriptions).",
          additionalProperties: true,
        },
        code: {
          type: "string",
          description: "Inline source code (use with or without path). Not with template.",
        },
        path: {
          type: "string",
          description: "Workspace-relative script path. Not with template.",
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
