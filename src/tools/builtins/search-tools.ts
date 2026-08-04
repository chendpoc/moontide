import { defineTools, type ToolSpec } from "../define-tool.js";
import type { ToolDefinition } from "../types.js";
import { TOOL_NAMES } from "../names.js";
import { runGrep } from "./grep.js";

const SEARCH_TOOL_SPECS: ToolSpec[] = [
  {
    name: TOOL_NAMES.GREP,
    description:
      "Search code in the workspace with ripgrep (rg) or grep. Prefer over bash for code search.",
    permission: { kind: "path", field: "path" },
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex pattern to search for." },
        path: { type: "string", description: "Relative path to search (default .)." },
        glob: { type: "string", description: "Optional file glob filter, e.g. *.ts." },
        max_results: { type: "integer", description: "Max matches (default 50, cap 200)." },
        case_insensitive: { type: "boolean" },
      },
      required: ["pattern"],
    },
    run: (input) =>
      runGrep({
        pattern: String(input.pattern ?? ""),
        path: input.path === undefined ? undefined : String(input.path),
        glob: input.glob === undefined ? undefined : String(input.glob),
        max_results: input.max_results === undefined ? undefined : Number(input.max_results),
        case_insensitive: input.case_insensitive === true,
      }),
  },
];

export function defineSearchTools(): ToolDefinition[] {
  return defineTools(SEARCH_TOOL_SPECS);
}
