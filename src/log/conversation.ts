import { emitDraft } from "./bus.js";
import { truncateOneLine } from "../utils/text.js";

export function emitUserPrompt(prompt: string): void {
  emitDraft({
    turn: 0,
    phase: "pre_llm",
    channel: "conversation",
    kind: "user_prompt",
    payload: { text: prompt },
    preview: truncateOneLine(prompt, 80),
  });
}

export function emitFinalReply(turn: number, text: string): void {
  emitDraft({
    turn,
    phase: "stop",
    channel: "conversation",
    kind: "final",
    payload: { text },
    preview: truncateOneLine(text, 80),
  });
}
