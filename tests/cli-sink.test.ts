import { describe, expect, it } from "vitest";

import {
  setContextCliOverride,
  setEventsDisplayCliOverride,
  setTraceCliOverride,
} from "../src/events/sinks/cli.js";
import { stripAnsi } from "../src/events/format/shared.js";
import { formatEventForCli } from "../src/events/sinks/cli.js";
import type { AgentEvent } from "../src/events/types.js";

function makeEvent(partial: Partial<AgentEvent>): AgentEvent {
  return {
    id: "id",
    seq: 1,
    runId: "run",
    turn: 2,
    phase: "post_llm",
    channel: "trace",
    kind: "thinking",
    ts: Date.now(),
    payload: { body: "plan" },
    preview: "plan",
    ...partial,
  };
}

function visible(line: string | null): string {
  return line ? stripAnsi(line) : "";
}

describe("CliSink formatting", () => {
  it("renders trace as timeline steps", () => {
    setTraceCliOverride(true);
    const line = formatEventForCli(makeEvent({ kind: "thinking", preview: "plan" }));
    expect(visible(line)).toContain("plan");
    setTraceCliOverride(null);
  });

  it("returns null when trace display off", () => {
    setTraceCliOverride(null);
    const line = formatEventForCli(makeEvent({ kind: "tool_use", preview: "x" }));
    expect(line).toBeNull();
  });
});
