import type { ToolSchema } from "../llm/protocol/types.js";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages/messages.js";

import { modelId } from "../config.js";
import type { ContextSnapshot } from "./types.js";

export function buildSnapshot(context: Record<string, unknown>): ContextSnapshot {
  return {
    turn: Number(context.turn ?? 0),
    messages: (context.messages ?? []) as MessageParam[],
    system: String(context.system ?? ""),
    tools: (context.tools ?? []) as ToolSchema[],
    modelId: modelId(),
    response: context.response as ContextSnapshot["response"],
  };
}
