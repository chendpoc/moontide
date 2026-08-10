import { describe, expect, it } from "vitest";

import { runChecksOnOutput } from "../src/graders/objective-checks.js";
import type { EvalRunOutput } from "../src/types.js";

function stubOutput(partial: Partial<EvalRunOutput>): EvalRunOutput {
  return {
    harnessName: "test",
    caseId: "case",
    repetition: 1,
    sessionId: "s1",
    reply: "",
    turn: 1,
    items: [],
    durationMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    toolCallCount: 0,
    ...partial,
  };
}

describe("objective tool checks", () => {
  it("passes tool_min_count", () => {
    const outcome = runChecksOnOutput(stubOutput({ toolCallCount: 3 }), [
      { kind: "tool_min_count", min: 2 },
    ]);
    expect(outcome.allPass).toBe(true);
  });

  it("passes tool_called from items", () => {
    const outcome = runChecksOnOutput(
      stubOutput({
        toolCallCount: 1,
        items: [
          {
            id: "1",
            sessionId: "s1",
            turn: 1,
            at: "t",
            kind: "tool_invocation",
            toolUseId: "u1",
            name: "grep",
            input: { pattern: "TODO" },
          },
        ],
      }),
      [{ kind: "tool_called", name: "grep" }],
    );
    expect(outcome.allPass).toBe(true);
  });

  it("passes work_mem_used", () => {
    const outcome = runChecksOnOutput(
      stubOutput({ workMemId: "wm-1" }),
      [{ kind: "work_mem_used" }],
    );
    expect(outcome.allPass).toBe(true);
  });

  it("accepts (?i) prefix in reply_matches", () => {
    const outcome = runChecksOnOutput(stubOutput({ reply: "Hello there" }), [
      { kind: "reply_matches", pattern: "(?i)\\b(hi|hello|hey)\\b" },
    ]);
    expect(outcome.allPass).toBe(true);
  });
});
