import { describe, expect, it } from "vitest";

import { checkArmsComparable } from "../src/comparability.js";

describe("checkArmsComparable", () => {
  it("passes when models match after normalization", () => {
    const result = checkArmsComparable(
      { name: "baseline" },
      { name: "candidate" },
    );
    expect(result.comparable).toBe(true);
  });

  it("fails when agent models differ", () => {
    const result = checkArmsComparable(
      { name: "baseline", model: "deepseek-v4-flash" },
      { name: "candidate", model: "deepseek-v4-pro" },
    );
    expect(result.comparable).toBe(false);
    expect(result.reason).toMatch(/agent model mismatch/);
  });

  it("fails when judge models differ", () => {
    const result = checkArmsComparable(
      { name: "baseline", judgeModel: "deepseek-v4-flash" },
      { name: "candidate", judgeModel: "deepseek-v4-pro" },
    );
    expect(result.comparable).toBe(false);
    expect(result.reason).toMatch(/judge model mismatch/);
  });
});
