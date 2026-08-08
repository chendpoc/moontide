/** Rendering protocol deltas (assistant streaming only). */

export type StreamDelta =
  | { kind: "text_delta"; text: string }
  | { kind: "thinking_delta"; text: string }
  | { kind: "tool_call_delta"; toolCallId: string; toolName: string; argsJson: string };
