import type { ContentBlock } from "@anthropic-ai/sdk/resources/messages/messages.js";

import { registerSlot } from "../../events/orchestrator.js";
import type { EventDraft } from "../../events/types.js";
import { collectFromResponse, collectFromToolResult } from "./collector.js";

function handlePostLlmTrace(ctx: Record<string, unknown>): EventDraft[] {
  const turn = Number(ctx.turn ?? 0);
  const response = ctx.response as { content?: ContentBlock[] } | undefined;
  if (!response) {
    return [];
  }
  return collectFromResponse(response, turn);
}

function handlePostToolTrace(ctx: Record<string, unknown>): EventDraft[] {
  return collectFromToolResult(ctx);
}

export function registerTracePlugin(): void {
  registerSlot("post_llm:trace", handlePostLlmTrace);
  registerSlot("post_tool:trace", handlePostToolTrace);
}
