import { deepResearchEnabled } from "../../config.js";
import type { ToolDefinition } from "../../toolkit/types.js";
import { runDeepResearch } from "./handler.js";

export function defineDeepResearchTool(): ToolDefinition | null {
  if (!deepResearchEnabled()) {
    return null;
  }

  return {
    schema: {
      name: "deep_research",
      description:
        "Search the web and synthesize findings for an open-ended research question. Requires user approval (network).",
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
    },
    handler: (input, _ctx) =>
      runDeepResearch({
        query: String(input.query ?? ""),
        max_results: input.max_results === undefined ? undefined : Number(input.max_results),
      }),
  };
}

export { runDeepResearch } from "./handler.js";
export type { DeepResearchInput, DeepResearchResult } from "./types.js";
