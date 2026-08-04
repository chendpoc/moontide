import type { ToolSchema } from "../llm/protocol/types.js";
import type { Message } from "../llm/protocol/types.js";

import { modelId } from "../config.js";
import type { ContextSnapshot } from "./types.js";

export function buildSnapshot(context: Record<string, unknown>): ContextSnapshot {
  return {
    turn: Number(context.turn ?? 0),
    messages: (context.messages ?? []) as Message[],
    system: String(context.system ?? ""),
    tools: (context.tools ?? []) as ToolSchema[],
    modelId: modelId(),
    response: context.response as ContextSnapshot["response"],
  };
}
