import { describe, expect, it } from "vitest";

import { parsePairwiseVerdictText } from "../src/graders/llm-judge.js";

describe("eval smoke", () => {
  it("pairwise judge parser accepts JSON in prose", () => {
    const verdict = parsePairwiseVerdictText(
      'Verdict:\n{"score":4,"winner":"candidate","rationale":"better"}',
    );
    expect(verdict.score).toBe(4);
    expect(verdict.winner).toBe("candidate");
  });
});
