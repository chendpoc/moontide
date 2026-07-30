import { describe, expect, it, beforeEach, afterEach } from "vitest";

import {
  disableTestCollector,
  enableTestCollector,
  emitDraft,
  getCollectedEvents,
} from "../src/events/bus.js";
import { resetRun, newRunId } from "../src/events/run.js";

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
      kind: "context_metrics",
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

describe("run id format", () => {
  it("uses local timestamp plus random suffix", () => {
    const id = newRunId(new Date(2026, 6, 30, 14, 30, 45));
    expect(id).toMatch(/^20260730-143045-[0-9a-f]{8}$/);
  });

  it("generates ids on resetRun without override", () => {
    const id = resetRun();
    expect(id).toMatch(/^\d{8}-\d{6}-[0-9a-f]{8}$/);
  });
});
