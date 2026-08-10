import { describe, expect, it } from "vitest";

import {
  parseBatchVerdictsText,
  parsePairwiseVerdict,
  parsePairwiseVerdictText,
} from "../src/graders/llm-judge.js";
import {
  runChecksOnOutput,
  verdictFromObjectiveChecks,
} from "../src/graders/objective-checks.js";
import type { EvalRunOutput } from "../src/types.js";

function mockOutput(reply: string, error?: string): EvalRunOutput {
  return {
    harnessName: "test",
    caseId: "c1",
    repetition: 1,
    sessionId: "s",
    reply,
    turn: 1,
    items: [],
    durationMs: 1,
    inputTokens: 1,
    outputTokens: 1,
    toolCallCount: 0,
    error,
  };
}

describe("parsePairwiseVerdict", () => {
  it("parses score winner and rationale", () => {
    const verdict = parsePairwiseVerdict({
      score: 4,
      winner: "candidate",
      rationale: "Clearer structure",
    });
    expect(verdict.score).toBe(4);
    expect(verdict.winner).toBe("candidate");
    expect(verdict.rationale).toContain("Clearer");
  });

  it("clamps score to 1-5", () => {
    expect(parsePairwiseVerdict({ score: 9, winner: "candidate", rationale: "x" }).score).toBe(5);
    expect(parsePairwiseVerdict({ score: 0, winner: "baseline", rationale: "x" }).score).toBe(1);
  });

  it("parsePairwiseVerdictText handles JSON blob", () => {
    const verdict = parsePairwiseVerdictText(
      `{"score":3,"winner":"tie","rationale":"same quality"}`,
    );
    expect(verdict.score).toBe(3);
    expect(verdict.winner).toBe("tie");
  });
});

describe("parseBatchVerdictsText", () => {
  it("returns one verdict per case id", () => {
    const map = parseBatchVerdictsText(
      JSON.stringify({
        verdicts: [
          { caseId: "a::1", score: 4, winner: "candidate", rationale: "better" },
          { caseId: "b::1", score: 3, winner: "tie", rationale: "ok" },
        ],
      }),
      ["a::1", "b::1"],
    );
    expect(map.get("a::1")?.score).toBe(4);
    expect(map.get("b::1")?.winner).toBe("tie");
  });
});

describe("objective checks", () => {
  it("runChecksOnOutput counts passes", () => {
    const result = runChecksOnOutput(mockOutput("exports runLoop from sample.ts"), [
      { kind: "reply_contains", value: "runLoop" },
    ]);
    expect(result.allPass).toBe(true);
    expect(result.passCount).toBe(1);
  });

  it("verdictFromObjectiveChecks prefers candidate when more checks pass", () => {
    const baseline = { passCount: 0, totalChecks: 1, allPass: false, details: [] };
    const candidate = { passCount: 1, totalChecks: 1, allPass: true, details: [] };
    const verdict = verdictFromObjectiveChecks(baseline, candidate);
    expect(verdict?.winner).toBe("candidate");
    expect(verdict?.score).toBeGreaterThanOrEqual(4);
  });

  it("verdictFromObjectiveChecks returns tie when both pass all", () => {
    const pass = { passCount: 2, totalChecks: 2, allPass: true, details: [] };
    const verdict = verdictFromObjectiveChecks(pass, pass);
    expect(verdict?.winner).toBe("tie");
    expect(verdict?.score).toBe(3);
  });
});
