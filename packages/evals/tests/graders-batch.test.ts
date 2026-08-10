import { describe, expect, it, vi } from "vitest";

import { gradePairBatch } from "../src/graders/index.js";
import * as llmJudge from "../src/graders/llm-judge.js";
import type { PairGradeItem } from "../src/types.js";

function item(caseId: string, mode: "objective" | "subjective"): PairGradeItem {
  return {
    caseId,
    caseDef: {
      id: caseId,
      category: mode === "objective" ? "coding" : "deep_task",
      gradingMode: mode,
      steps: [{ type: "prompt", content: "test" }],
      expectedChecks:
        mode === "objective" ? [{ kind: "reply_contains", value: "same" }] : undefined,
    },
    baseline: {
      harnessName: "baseline",
      caseId,
      repetition: 1,
      sessionId: "s1",
      reply: "same answer",
      turn: 1,
      items: [],
      durationMs: 1,
      inputTokens: 1,
      outputTokens: 1,
      toolCallCount: 0,
    },
    candidate: {
      harnessName: "candidate",
      caseId,
      repetition: 1,
      sessionId: "s2",
      reply: "same answer",
      turn: 1,
      items: [],
      durationMs: 1,
      inputTokens: 1,
      outputTokens: 1,
      toolCallCount: 0,
    },
  };
}

describe("gradePairBatch", () => {
  it("derives tie for identical objective outputs without LLM", async () => {
    const results = await gradePairBatch([item("obj-1", "objective")]);
    expect(results[0]?.verdict.winner).toBe("tie");
    expect(results[0]?.verdict.score).toBe(3);
  });

  it("falls back to single grading when batch parse fails", async () => {
    const batchSpy = vi.spyOn(llmJudge, "gradePairBatchWithLlm").mockResolvedValue({
      verdicts: new Map([
        [
          "sub-1::1",
          {
            score: 1,
            winner: "tie",
            rationale: "Failed to parse batch judge JSON",
          },
        ],
      ]),
      judgeModel: "test",
      rawText: "bad",
    });
    const singleSpy = vi.spyOn(llmJudge, "gradePairWithLlm").mockResolvedValue({
      verdict: { score: 4, winner: "candidate", rationale: "ok" },
      judgeModel: "test",
      rawText: "{}",
    });

    const results = await gradePairBatch(
      [item("sub-1", "subjective"), item("sub-2", "subjective")],
      { batchSize: 2 },
    );

    expect(batchSpy).toHaveBeenCalled();
    expect(singleSpy).toHaveBeenCalled();
    expect(results.every((r) => r.verdict.score === 4)).toBe(true);

    batchSpy.mockRestore();
    singleSpy.mockRestore();
  });
});
