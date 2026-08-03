import type { ToolSchema } from "../../llm/protocol/types.js";
import type { ComposeContextInputV1, ContextManifest } from "./types.js";

export function buildContextManifestV1(
  input: ComposeContextInputV1,
  tools: ToolSchema[],
): ContextManifest {
  return {
    turn: input.turn,
    toolDefinitionNames: tools.map((tool) => tool.name),
  };
}

