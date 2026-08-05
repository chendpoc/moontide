import { defineTools, type ToolSpec } from "../../define-tool.js";
import type { ToolDefinition } from "../../types.js";
import { TOOL_NAMES } from "../../names.js";
import { runBash } from "./bash.js";

const SHELL_TOOL_SPECS: ToolSpec[] = [
  {
    name: TOOL_NAMES.BASH,
    description: "Run a shell command in the workspace.",
    permission: { kind: "bash", field: "command" },
    capability: "exec",
    input_schema: {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
    },
    run: (input) => runBash(String(input.command ?? "")),
  },
];

export function defineShellTools(): ToolDefinition[] {
  return defineTools(SHELL_TOOL_SPECS);
}
