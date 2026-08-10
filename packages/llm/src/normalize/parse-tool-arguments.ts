import type { ContentBlock } from "../protocol/types.js";

export interface ParsedToolCallInput {
  input: Record<string, unknown>;
  argumentStatus: "ok" | "malformed_tool_arguments";
  rawArguments?: string;
}

/** Parse OpenAI `function.arguments` JSON string into a tool_use input block. */
export function parseToolCallArguments(
  id: string,
  name: string,
  rawArguments: string,
): Extract<ContentBlock, { type: "tool_use" }> {
  const trimmed = rawArguments.trim();
  if (trimmed.length === 0) {
    return {
      type: "tool_use",
      id,
      name,
      input: {},
      argumentStatus: "ok",
    };
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        type: "tool_use",
        id,
        name,
        input: {},
        argumentStatus: "malformed_tool_arguments",
        rawArguments,
      };
    }
    return {
      type: "tool_use",
      id,
      name,
      input: parsed as Record<string, unknown>,
      argumentStatus: "ok",
    };
  } catch {
    return {
      type: "tool_use",
      id,
      name,
      input: {},
      argumentStatus: "malformed_tool_arguments",
      rawArguments,
    };
  }
}
