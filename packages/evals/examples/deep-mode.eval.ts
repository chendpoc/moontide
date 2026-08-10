import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createMoonTideEvalHarness,
  gradePair,
  hasEvalApiKey,
  runEvalCase,
  summarizeComparison,
} from "../src/index.js";
import type { EvalCaseDefinition } from "../src/types.js";

const integration = hasEvalApiKey() ? describe : describe.skip;

const baseline = createMoonTideEvalHarness({
  name: "baseline",
  disableProtocolReminders: true,
});
const candidate = createMoonTideEvalHarness({
  name: "with-protocol-reminders",
});

const deepCase: EvalCaseDefinition = {
  id: "deep-cache-decision",
  category: "deep_task",
  gradingMode: "subjective",
  steps: [
    {
      type: "prompt",
      content: "deep: pick redis or memcached for session cache with persistence",
    },
  ],
};

integration("deep-mode eval (real LLM)", () => {
  beforeEach(() => {
    vi.stubEnv("MOONTIDE_ENV", "production");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("compares baseline vs candidate with pairwise judge", async () => {
    const baselineOut = await runEvalCase(baseline, deepCase, 1);
    const candidateOut = await runEvalCase(candidate, deepCase, 1);
    const grade = await gradePair(baselineOut, candidateOut, deepCase);

    const summary = summarizeComparison("baseline", "with-protocol-reminders", [
      {
        caseId: deepCase.id,
        category: deepCase.category,
        gradingMode: deepCase.gradingMode,
        repetition: 1,
        baseline: baselineOut,
        candidate: candidateOut,
        verdict: grade.verdict,
        judgeModel: grade.judgeModel,
      },
    ]);

    expect(summary.pairedCount).toBe(1);
    expect(summary.meanScore).toBeGreaterThanOrEqual(1);
    expect(summary.meanScore).toBeLessThanOrEqual(5);
  }, 180_000);
});
