import { describe, expect, it } from "vitest";

import { setContextCliOverride, setEventsDisplayCliOverride, setEventsOverride, setTraceCliOverride } from "../src/events/cli-session.js";
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
    const text = visible(line);
    expect(text).toContain("turn 02");
    expect(text).toContain("think");
    expect(text).toContain("plan");
    expect(text).not.toContain("[trace]");
  });

  it("hides context by default", () => {
    setContextCliOverride(null);
    const line = formatEventForCli(
      makeEvent({
        channel: "context",
        kind: "metrics_pre",
        preview: "est",
        payload: {
          report: {
            estimatedTokens: 100,
            limit: 128000,
            percentUsed: 0.1,
            headroom: 127900,
            breakdown: {
              system: 10,
              toolSchemas: 20,
              user: 30,
              assistant: 20,
              thinking: 10,
              toolResults: 10,
              total: 100,
            },
            structure: { messageCount: 3, toolCallCount: 1, maxToolResultChars: 100 },
            messageLines: [],
            trend: { deltaTokens: 100, cumulativeTokens: 100 },
            alerts: [],
            modelId: "test",
            turn: 2,
          },
        },
      }),
    );
    expect(line).toBeNull();
  });

  it("renders context metrics_pre as boxed dashboard", () => {
    setContextCliOverride(true);
    const line = formatEventForCli(
      makeEvent({
        channel: "context",
        kind: "metrics_pre",
        preview: "est",
        payload: {
          report: {
            estimatedTokens: 100,
            limit: 128000,
            percentUsed: 0.1,
            headroom: 127900,
            breakdown: {
              system: 10,
              toolSchemas: 20,
              user: 30,
              assistant: 20,
              thinking: 10,
              toolResults: 10,
              total: 100,
            },
            structure: { messageCount: 3, toolCallCount: 1, maxToolResultChars: 100 },
            messageLines: [],
            trend: { deltaTokens: 100, cumulativeTokens: 100 },
            alerts: [],
            modelId: "test",
            turn: 2,
          },
        },
      }),
    );
    const text = visible(line);
    expect(text).toContain("CONTEXT");
    expect(text).toContain("turn 02");
    expect(text).toContain("pre");
    expect(text).toContain("100");
    expect(text).toContain("Headroom");
    expect(text).not.toContain("[context]");
  });

  it("renders conversation user_prompt when events display is on", () => {
    setEventsDisplayCliOverride(true);
    const line = formatEventForCli(
      makeEvent({
        channel: "conversation",
        kind: "user_prompt",
        payload: { text: "Fix the bug" },
        preview: "Fix the bug",
      }),
    );
    const text = visible(line);
    expect(text).toContain("EVENT");
    expect(text).toContain("user_prompt");
    expect(text).toContain("Fix the bug");
    setEventsDisplayCliOverride(null);
  });

  it("renders audit tool_use when events display is on", () => {
    setEventsDisplayCliOverride(true);
    const line = formatEventForCli(
      makeEvent({
        channel: "audit",
        kind: "tool_use",
        payload: { toolName: "Bash", toolInput: { command: "ls" } },
        preview: "Bash",
      }),
    );
    const text = visible(line);
    expect(text).toContain("EVENT");
    expect(text).toContain("audit");
    expect(text).toContain("Bash");
    setEventsDisplayCliOverride(null);
  });

  it("hides conversation and audit by default", () => {
    setEventsDisplayCliOverride(null);
    const prompt = formatEventForCli(
      makeEvent({
        channel: "conversation",
        kind: "user_prompt",
        payload: { text: "Fix the bug" },
        preview: "Fix the bug",
      }),
    );
    const audit = formatEventForCli(
      makeEvent({
        channel: "audit",
        kind: "tool_use",
        payload: { toolName: "Bash", toolInput: { command: "ls" } },
        preview: "Bash",
      }),
    );
    expect(prompt).toBeNull();
    expect(audit).toBeNull();
  });

  it("skips conversation final to avoid duplicating stdout", () => {
    const line = formatEventForCli(
      makeEvent({
        channel: "conversation",
        kind: "final",
        payload: { text: "Done" },
        preview: "Done",
      }),
    );
    expect(line).toBeNull();
  });

  it("hides trace when trace override is off", () => {
    setTraceCliOverride(false);
    const line = formatEventForCli(makeEvent({ kind: "tool_use", preview: "x" }));
    expect(line).toBeNull();
    setTraceCliOverride(null);
  });

  it("renders all three channels when toggles are on", () => {
    setContextCliOverride(true);
    setTraceCliOverride(true);
    setEventsDisplayCliOverride(true);

    const contextLine = formatEventForCli(
      makeEvent({
        channel: "context",
        kind: "metrics_pre",
        preview: "est",
        payload: {
          report: {
            estimatedTokens: 10,
            limit: 128000,
            percentUsed: 0.1,
            headroom: 127990,
            breakdown: {
              system: 1,
              toolSchemas: 1,
              user: 1,
              assistant: 1,
              thinking: 1,
              toolResults: 1,
              total: 10,
            },
            structure: { messageCount: 1, toolCallCount: 0, maxToolResultChars: 0 },
            alerts: [],
            modelId: "test",
            turn: 2,
          },
        },
      }),
    );
    const traceLine = formatEventForCli(makeEvent({ channel: "trace", kind: "thinking", preview: "plan" }));
    const eventLine = formatEventForCli(
      makeEvent({
        channel: "conversation",
        kind: "user_prompt",
        payload: { text: "hi" },
        preview: "hi",
      }),
    );

    expect(contextLine).not.toBeNull();
    expect(traceLine).not.toBeNull();
    expect(eventLine).not.toBeNull();

    setContextCliOverride(null);
    setTraceCliOverride(null);
    setEventsDisplayCliOverride(null);
  });
});
