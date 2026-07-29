import { emitDraft } from "./bus.js";

export function emitUserPrompt(prompt: string): void {
  emitDraft({
    turn: 0,
    phase: "pre_llm",
    channel: "conversation",
    kind: "user_prompt",
    payload: { text: prompt },
    preview: prompt.length > 80 ? `${prompt.slice(0, 79)}…` : prompt,
  });
}

export function emitFinalReply(turn: number, text: string): void {
  emitDraft({
    turn,
    phase: "stop",
    channel: "conversation",
    kind: "final",
    payload: { text },
    preview: text.length > 80 ? `${text.slice(0, 79)}…` : text,
  });
}
