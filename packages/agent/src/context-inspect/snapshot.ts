import type { ToolSchema } from "@moontide/llm/protocol";
import type { Message } from "@moontide/llm/protocol";

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
