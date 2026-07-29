import { describe, expect, it, beforeEach } from "vitest";

import {
  clearSlots,
  getSlotCallOrderForTest,
  registerSlot,
  runPhase,
} from "../src/events/orchestrator.js";
import type { EventDraft, PhaseSlot } from "../src/events/types.js";

describe("orchestrator order", () => {
  const callOrder: PhaseSlot[] = [];

  beforeEach(() => {
    clearSlots();
    callOrder.length = 0;
    for (const slot of getSlotCallOrderForTest()) {
      registerSlot(slot, () => {
        callOrder.push(slot);
        return [] satisfies EventDraft[];
      });
    }
  });

  it("runs slots in PHASE_ORDER for each phase", () => {
    runPhase("pre_llm", { turn: 1 });
    expect(callOrder).toEqual(["pre_llm:context"]);

    runPhase("post_llm", { turn: 1 });
    expect(callOrder).toEqual(["pre_llm:context", "post_llm:trace", "post_llm:context"]);

    runPhase("post_tool", { turn: 1 });
    expect(callOrder).toEqual([
      "pre_llm:context",
      "post_llm:trace",
      "post_llm:context",
      "post_tool:trace",
    ]);
  });
});
