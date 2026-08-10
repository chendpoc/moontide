import type { ThinkingLevel } from "../protocol/types.js";

/** Map MoonTide thinking level to Responses API `reasoning.effort`. */
export function mapThinkingLevelToResponsesEffort(level: ThinkingLevel | undefined): string {
  if (!level || level === "off") {
    return "none";
  }
  return level;
}

/** Apply Responses API reasoning config to a request body. */
export function applyResponsesReasoning(body: Record<string, unknown>, level: ThinkingLevel | undefined): void {
  body.reasoning = { effort: mapThinkingLevelToResponsesEffort(level) };
}
