import { describe, expect, it, vi } from "vitest";

  vi.mock("@moontide/llm", () => ({
  resolveRoute: (modelId: string, options?: { jsonObject?: boolean }) => ({
    logicalModelId: modelId,
    providerPresetId: "deepseek",
    vendorModelId: modelId,
    adapterFamily: options?.jsonObject ? "openai-chat-completions" : "anthropic-messages",
    thinkingLevel: "off",
  }),
}));

import { buildEvalRunManifest, suiteContentHash } from "../src/manifest.js";
import type { EvalCaseDefinition } from "../src/types.js";

const cases: EvalCaseDefinition[] = [
  {
    id: "case-a",
    category: "regression",
    gradingMode: "objective",
    steps: [{ type: "prompt", content: "hi" }],
  },
];

describe("suiteContentHash", () => {
  it("is stable for the same case set", () => {
    const a = suiteContentHash("2", cases);
    const b = suiteContentHash("2", cases);
    expect(a).toBe(b);
    expect(a).toHaveLength(12);
  });
});

describe("buildEvalRunManifest", () => {
  it("includes route fields and intervention", () => {
    const manifest = buildEvalRunManifest({
      suiteVersion: "2",
      suitePath: "v2/regression",
      cases,
      repetitions: 1,
      gitSha: "abc123",
      intervention: { mode: "toggle", headSha: "abc123" },
      baseline: { name: "baseline" },
      candidate: { name: "candidate", disableProtocolReminders: true },
      comparable: true,
      startedAt: "2026-08-10T00:00:00.000Z",
      finishedAt: "2026-08-10T00:01:00.000Z",
    });

    expect(manifest.suiteHash).toBeTruthy();
    expect(manifest.caseIds).toEqual(["case-a"]);
    expect(manifest.baseline.route.adapterFamily).toBe("anthropic-messages");
    expect(manifest.candidate.judgeRoute.adapterFamily).toBe("openai-chat-completions");
    expect(manifest.candidate.featureToggles.protocolReminders).toBe(false);
    expect(manifest.intervention.mode).toBe("toggle");
  });
});
