import { deepResearchEnabled } from "../../../config.js";
import { defineTools, type ToolSpec } from "../../../tools/define-tool.js";
import type { ToolDefinition } from "../../../tools/types.js";
import { TOOL_NAMES } from "../../../tools/names.js";
import { runDeepResearch } from "./handler.js";

const DEEP_RESEARCH_TOOL_SPECS: ToolSpec[] = [
  {
    name: TOOL_NAMES.DEEP_RESEARCH,
    description:
      "Search the web and synthesize findings for an open-ended research question. Requires user approval (network).",
    permission: { kind: "fixed", decision: "ask" },
    capability: "network",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Research question or topic to investigate.",
        },
        max_results: {
          type: "integer",
          description: "Maximum number of sources to consider (optional).",
        },
      },
      required: ["query"],
    },
    run: (input, _ctx) =>
      runDeepResearch({
        query: String(input.query ?? ""),
        max_results: input.max_results === undefined ? undefined : Number(input.max_results),
      }),
  },
];

export function defineDeepResearchTools(): ToolDefinition[] | null {
  if (!deepResearchEnabled()) {
    return null;
  }
  return defineTools(DEEP_RESEARCH_TOOL_SPECS);
}
