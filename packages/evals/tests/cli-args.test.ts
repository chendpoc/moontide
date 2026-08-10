import { describe, expect, it } from "vitest";

import {
  parseEvalCliArgs,
  resolveAgentConcurrency,
  resolveJudgeBatchSize,
  selectSuiteCases,
} from "../src/cli-args.js";
import type { EvalCaseDefinition } from "../src/types.js";

const cases: EvalCaseDefinition[] = [
  {
    id: "deep-cache-decision",
    category: "deep_task",
    gradingMode: "subjective",
    steps: [{ type: "prompt", content: "deep: test" }],
  },
  {
    id: "coding-read-sample",
    category: "coding",
    gradingMode: "objective",
    featureSurface: ["tooling"],
    steps: [{ type: "prompt", content: "read" }],
    expectedChecks: [{ kind: "reply_contains", value: "x" }],
  },
  {
    id: "context-recall",
    category: "coding",
    gradingMode: "objective",
    featureSurface: ["context"],
    steps: [{ type: "prompt", content: "recall" }],
    expectedChecks: [{ kind: "reply_contains", value: "x" }],
  },
];

describe("resolveAgentConcurrency", () => {
  it("defaults to 4", () => {
    expect(resolveAgentConcurrency()).toBe(4);
  });

  it("caps at 10", () => {
    expect(resolveAgentConcurrency(99)).toBe(10);
  });

  it("floors at 1", () => {
    expect(resolveAgentConcurrency(0)).toBe(1);
  });
});

describe("resolveJudgeBatchSize", () => {
  it("returns 1 for single mode", () => {
    expect(resolveJudgeBatchSize("single", 8)).toBe(1);
  });

  it("returns explicit batch size in batch mode", () => {
    expect(resolveJudgeBatchSize("batch", 4)).toBe(4);
  });

  it("defaults to 8 in batch mode", () => {
    expect(resolveJudgeBatchSize("batch")).toBe(8);
  });
});

describe("selectSuiteCases", () => {
  it("selects exact case id", () => {
    const selected = selectSuiteCases(cases, { caseId: "deep-cache-decision" }, "suite.json");
    expect(selected).toHaveLength(1);
    expect(selected[0]?.id).toBe("deep-cache-decision");
  });

  it("selects substring filter", () => {
    const selected = selectSuiteCases(cases, { caseFilter: "coding" }, "suite.json");
    expect(selected).toHaveLength(1);
    expect(selected[0]?.id).toBe("coding-read-sample");
  });

  it("case id wins over filter", () => {
    const selected = selectSuiteCases(
      cases,
      { caseId: "deep-cache-decision", caseFilter: "coding" },
      "suite.json",
    );
    expect(selected[0]?.id).toBe("deep-cache-decision");
  });

  it("throws when case id missing", () => {
    expect(() => selectSuiteCases(cases, { caseId: "missing" }, "suite.json")).toThrow(
      /not found/,
    );
  });

  it("filters by featureSurface", () => {
    const selected = selectSuiteCases(cases, { featureSurface: "context" }, "suite.json");
    expect(selected).toHaveLength(1);
    expect(selected[0]?.id).toBe("context-recall");
  });
});

describe("parseEvalCliArgs", () => {
  it("parses single-case debug flags", () => {
    const args = parseEvalCliArgs([
      "v1/B-deep-protocol.json",
      "--case-id=deep-cache-decision",
      "--judge-mode=single",
      "--repetitions=5",
    ]);
    expect(args.suitePaths).toEqual(["v1/B-deep-protocol.json"]);
    expect(args.caseId).toBe("deep-cache-decision");
    expect(args.judgeBatchSize).toBe(1);
    expect(args.repetitions).toBe(5);
    expect(args.phase).toBe("full");
  });

  it("expands v2 to all categories", () => {
    const args = parseEvalCliArgs(["v2"]);
    expect(args.suitePaths).toHaveLength(6);
    expect(args.suitePaths).toContain("v2/external_research");
  });

  it("parses harness and merge gate flags", () => {
    const args = parseEvalCliArgs([
      "v2/coding",
      "--merge-gate",
      "--verbose",
      "--baseline-from=packages/evals/baseline.json",
      "--baseline-name=off",
      "--candidate-name=on",
    ]);
    expect(args.mergeGate).toBe(true);
    expect(args.verbose).toBe(true);
    expect(args.baselineFromPath).toBe("packages/evals/baseline.json");
    expect(args.harness.baseline.name).toBe("off");
    expect(args.harness.candidate.name).toBe("on");
    expect(args.harness.baseline.disableProtocolReminders).toBe(true);
  });

  it("rejects revision intervention", () => {
    expect(() =>
      parseEvalCliArgs(["v2/coding", "--intervention=revision"]),
    ).toThrow(/revision intervention is not supported/);
  });

  it("rejects base-ref", () => {
    expect(() => parseEvalCliArgs(["v2/coding", "--base-ref=main"])).toThrow(
      /--base-ref is not supported/,
    );
  });

  it("rejects invalid intervention mode", () => {
    expect(() => parseEvalCliArgs(["v2/coding", "--intervention=invalid"])).toThrow(
      /Invalid --intervention/,
    );
  });

  it("parses agent-only phase", () => {
    const args = parseEvalCliArgs(["v1/A-coding-smoke.json", "--agent-only"]);
    expect(args.phase).toBe("agent-only");
  });

  it("parses judge-only phase", () => {
    const args = parseEvalCliArgs([
      "v1/B-deep-protocol.json",
      "--judge-only",
      "--judge-from=/tmp/pairs.jsonl",
    ]);
    expect(args.phase).toBe("judge-only");
    expect(args.judgeFromPath).toBe("/tmp/pairs.jsonl");
  });

  it("rejects agent-only and judge-only together", () => {
    expect(() =>
      parseEvalCliArgs(["suite.json", "--agent-only", "--judge-from=/tmp/p.jsonl"]),
    ).toThrow(/not both/);
  });
});
