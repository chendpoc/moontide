import type { ToolChoice } from "../protocol/types.js";

/** Map MoonTide ToolChoice to OpenAI Responses API `tool_choice`. */
export function toResponsesToolChoice(
  choice: ToolChoice | undefined,
): string | Record<string, unknown> | undefined {
  if (!choice) {
    return undefined;
  }
  switch (choice.mode) {
    case "none":
      return "none";
    case "auto":
      return "auto";
    case "required":
      return "required";
    case "specified":
      return { type: "function", name: choice.name };
    default: {
      const _exhaustive: never = choice;
      return _exhaustive;
    }
  }
}
