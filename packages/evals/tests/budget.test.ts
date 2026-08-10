import { describe, expect, it } from "vitest";

import { BudgetLedger, usageCostMicroCny } from "../src/budget.js";

describe("usageCostMicroCny", () => {
  it("computes flash token cost in micro-CNY", () => {
    const cost = usageCostMicroCny(
      { inputTokens: 1_000_000, outputTokens: 500_000 },
      "deepseek-v4-flash",
    );
    expect(cost).toBe(1_000_000 * 0.2 + 500_000 * 0.4);
  });
});

describe("BudgetLedger", () => {
  it("tracks agent and judge usage separately", () => {
    const ledger = new BudgetLedger(10_000_000);
    ledger.recordAgentUsage({ inputTokens: 1000, outputTokens: 500 }, "deepseek-v4-flash");
    ledger.recordJudgeUsage({ inputTokens: 200, outputTokens: 100 }, "deepseek-v4-flash");

    const summary = ledger.summary();
    expect(summary.agentInputTokens).toBe(1000);
    expect(summary.judgeInputTokens).toBe(200);
    expect(summary.costMicroCny).toBeGreaterThan(0);
    expect(summary.budgetExceeded).toBe(false);
  });

  it("flags budget exceeded", () => {
    const ledger = new BudgetLedger(100);
    ledger.recordAgentUsage({ inputTokens: 1_000_000, outputTokens: 0 }, "deepseek-v4-flash");
    expect(ledger.exceedsLimit()).toBe(true);
    expect(ledger.summary().budgetExceeded).toBe(true);
  });
});
