import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { emitDraft, setSinks } from "../src/events/bus.js";
import {
  resetCliRenderState,
  formatEventForCli,
  CliSink,
} from "../src/events/sinks/cli.js";
import {
  setStderrWriterForTest,
} from "../src/events/sinks/stderr-writer.js";
import {
  setContextCliOverride,
  setEventsDisplayCliOverride,
  setTraceCliOverride,
} from "../src/events/cli-session.js";
import { stripAnsi } from "../src/events/format/shared.js";
import { resetRun } from "../src/events/run.js";
import type { AgentEvent } from "../src/events/types.js";

function makeEvent(partial: Partial<AgentEvent>): AgentEvent {
  return {
    id: "id",
    seq: partial.seq ?? 1,
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

describe("CliSink ordering", () => {
  const written: string[] = [];

  beforeEach(() => {
    resetRun("order-test");
    resetCliRenderState();
    setContextCliOverride(true);
    setTraceCliOverride(true);
    setEventsDisplayCliOverride(true);
    written.length = 0;
    setStderrWriterForTest((chunk) => {
      written.push(chunk);
      return true;
    });
    setSinks([new CliSink()]);
  });

  afterEach(() => {
    setStderrWriterForTest(null);
    setSinks([]);
    setContextCliOverride(null);
    setTraceCliOverride(null);
    setEventsDisplayCliOverride(null);
    resetCliRenderState();
  });

  it("preserves emit order for mixed channels in one turn", () => {
    const sequence: Partial<AgentEvent>[] = [
      {
        seq: 1,
        turn: 1,
        phase: "pre_llm",
        channel: "context",
        kind: "metrics_pre",
        preview: "est",
        payload: {
          report: {
            estimatedTokens: 50,
            limit: 128000,
            percentUsed: 0.1,
            headroom: 127950,
            breakdown: {
              system: 1,
              toolSchemas: 1,
              user: 1,
              assistant: 1,
              thinking: 1,
              toolResults: 1,
              total: 50,
            },
            structure: { messageCount: 1, toolCallCount: 0, maxToolResultChars: 0 },
            alerts: [],
            modelId: "test",
            turn: 1,
          },
        },
      },
      {
        seq: 2,
        turn: 1,
        phase: "post_llm",
        channel: "trace",
        kind: "thinking",
        preview: "think step",
        payload: { body: "think step" },
      },
      {
        seq: 3,
        turn: 1,
        phase: "post_llm",
        channel: "context",
        kind: "metrics_post",
        preview: "in=10 out=5",
        payload: {
          report: {
            estimatedTokens: 60,
            limit: 128000,
            percentUsed: 0.1,
            headroom: 127940,
            breakdown: {
              system: 1,
              toolSchemas: 1,
              user: 1,
              assistant: 1,
              thinking: 1,
              toolResults: 1,
              total: 60,
            },
            structure: { messageCount: 2, toolCallCount: 0, maxToolResultChars: 0 },
            usage: { inputTokens: 10, outputTokens: 5 },
            alerts: [],
            modelId: "test",
            turn: 1,
          },
        },
      },
      {
        seq: 4,
        turn: 1,
        phase: "post_tool",
        channel: "audit",
        kind: "tool_use",
        preview: "Bash",
        payload: { toolName: "Bash", toolInput: { command: "ls" } },
      },
    ];

    for (const partial of sequence) {
      emitDraft({
        turn: partial.turn ?? 1,
        phase: partial.phase ?? "pre_llm",
        channel: partial.channel ?? "context",
        kind: partial.kind ?? "metrics_pre",
        payload: partial.payload ?? {},
        preview: partial.preview,
      });
    }

    const text = stripAnsi(written.join(""));
    const contextIdx = text.indexOf("CONTEXT");
    const traceIdx = text.indexOf("think");
    const auditIdx = text.indexOf("audit");
    expect(contextIdx).toBeGreaterThanOrEqual(0);
    expect(traceIdx).toBeGreaterThan(contextIdx);
    expect(auditIdx).toBeGreaterThan(traceIdx);
    expect(text).toContain("context → trace");
    expect(text).toContain("context → audit");
  });

  it("writes each formatted block atomically", () => {
    const block = formatEventForCli(makeEvent({ kind: "thinking", preview: "atomic" }));
    expect(block).not.toBeNull();
    const sink = new CliSink();
    resetCliRenderState();
    written.length = 0;
    sink.handle(makeEvent({ seq: 1, turn: 1, kind: "thinking", preview: "atomic" }));
    expect(written).toHaveLength(1);
  });
});
