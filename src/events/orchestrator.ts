import { emitDraft } from "./bus.js";
import type { AgentPhase, EventDraft } from "./types.js";

export const PHASE_SLOTS = [
  "pre_llm:context",
  "post_llm:trace",
  "post_llm:context",
  "post_tool:trace",
] as const;

export type PhaseSlot = (typeof PHASE_SLOTS)[number];

export type SlotHandler = (ctx: Record<string, unknown>) => EventDraft[];

const handlers = new Map<PhaseSlot, SlotHandler>();

export function registerSlot(slot: PhaseSlot, handler: SlotHandler): void {
  handlers.set(slot, handler);
}

export function runPhase(phase: AgentPhase, ctx: Record<string, unknown>): void {
  const turn = Number(ctx.turn ?? 0);

  for (const slot of PHASE_SLOTS) {
    const [slotPhase] = slot.split(":") as [AgentPhase, string];
    if (slotPhase !== phase) {
      continue;
    }

    const handler = handlers.get(slot);
    if (!handler) {
      continue;
    }

    for (const draft of handler(ctx)) {
      emitDraft({
        ...draft,
        turn: draft.turn ?? turn,
        phase: draft.phase ?? phase,
      });
    }
  }
}

export function clearSlots(): void {
  handlers.clear();
}

export function getRegisteredSlots(): PhaseSlot[] {
  return [...handlers.keys()];
}

export function getSlotCallOrderForTest(): readonly PhaseSlot[] {
  return PHASE_SLOTS;
}
