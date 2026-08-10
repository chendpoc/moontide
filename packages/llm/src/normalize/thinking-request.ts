import type { ThinkingLevel } from "../protocol/types.js";

/** Apply DeepSeek/OpenAI-compatible thinking fields to a chat completion request body. */
export function applyThinkingLevel(body: Record<string, unknown>, level: ThinkingLevel | undefined): void {
  if (!level || level === "off") {
    body.thinking = { type: "disabled" };
    return;
  }
  body.thinking = { type: "enabled" };
  body.reasoning_effort = level;
}
