import { resolveToolDefinitions } from "./tool-definitions/resolve.js";
import type { ComposedContext, ComposeContextInput, ComposeContextInputV1 } from "./types.js";
import { buildContextManifestV1 } from "./manifest.js";

/** Compile per-turn LLM input slice (v1: messages + system + Tool Definitions). */
export function composeContextV1(input: ComposeContextInputV1): ComposedContext {
  const tools = resolveToolDefinitions();
  return {
    request: {
      system: input.system,
      messages: input.messages,
      tools,
    },
    manifest: buildContextManifestV1(input, tools),
  };
}

/** Full Context Composer (C1b) — stub until Session Log projection replaces splice. */
export function composeContext(_input: ComposeContextInput): ComposedContext {
  throw new Error("composeContext: full Session Log projection not implemented (C1b)");
}
