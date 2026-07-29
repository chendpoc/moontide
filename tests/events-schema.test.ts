import { describe, expect, it, beforeEach, afterEach } from "vitest";

import {
  disableTestCollector,
  enableTestCollector,
  emitDraft,
  getCollectedEvents,
} from "../src/events/bus.js";
import { resetRun } from "../src/events/run.js";

describe("AgentEvent schema", () => {
  beforeEach(() => {
    resetRun("test-run");
    enableTestCollector();
  });

  afterEach(() => {
    disableTestCollector();
  });

  it("assigns monotonic seq and runId", () => {
    const first = emitDraft({
      turn: 1,
      phase: "pre_llm",
      channel: "context",
      kind: "metrics_pre",
      payload: {},
    });
    const second = emitDraft({
      turn: 1,
      phase: "post_llm",
      channel: "trace",
      kind: "thinking",
      payload: { body: "hi" },
      preview: "hi",
    });

    expect(first.runId).toBe("test-run");
    expect(second.runId).toBe("test-run");
    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect(getCollectedEvents()).toHaveLength(2);
  });
});
