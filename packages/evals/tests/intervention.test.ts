import { describe, expect, it } from "vitest";

import {
  EvalInterventionError,
  harnessAbDiffFields,
  hasToggleIntervention,
  resolveEvalIntervention,
} from "../src/intervention.js";
import type { MoonTideEvalHarnessConfig } from "../src/types.js";

const baselineOnly: MoonTideEvalHarnessConfig = {
  name: "baseline",
  disableProtocolReminders: true,
};

const candidateOnly: MoonTideEvalHarnessConfig = {
  name: "with-feature",
  disableProtocolReminders: false,
};

const identical: MoonTideEvalHarnessConfig = {
  name: "baseline",
  disableProtocolReminders: false,
};

describe("harnessAbDiffFields", () => {
  it("detects disableProtocolReminders difference via featureToggles", () => {
    expect(harnessAbDiffFields(baselineOnly, candidateOnly)).toEqual(["featureToggles"]);
  });

  it("returns empty when harness configs match", () => {
    expect(harnessAbDiffFields(identical, { ...identical, name: "candidate" })).toEqual([]);
  });

  it("detects featureToggles difference", () => {
    const base: MoonTideEvalHarnessConfig = {
      name: "baseline",
      featureToggles: { foo: false },
    };
    const cand: MoonTideEvalHarnessConfig = {
      name: "candidate",
      featureToggles: { foo: true },
    };
    expect(harnessAbDiffFields(base, cand)).toEqual(["featureToggles"]);
  });
});

describe("resolveEvalIntervention", () => {
  it("auto-selects toggle when harness differs", () => {
    const resolved = resolveEvalIntervention({
      baseline: baselineOnly,
      candidate: candidateOnly,
    });
    expect(resolved.mode).toBe("toggle");
  });

  it("throws when no harness difference", () => {
    expect(() =>
      resolveEvalIntervention({
        baseline: identical,
        candidate: { ...identical, name: "candidate" },
      }),
    ).toThrow(EvalInterventionError);
  });

  it("throws when explicitly toggle but no diff", () => {
    expect(() =>
      resolveEvalIntervention({
        mode: "toggle",
        baseline: identical,
        candidate: { ...identical, name: "candidate" },
      }),
    ).toThrow(/harness difference/);
  });

  it("rejects unsupported revision mode", () => {
    expect(() =>
      resolveEvalIntervention({
        mode: "revision" as "toggle",
        baseline: baselineOnly,
        candidate: candidateOnly,
      }),
    ).toThrow(/Only toggle intervention is supported/);
  });
});

describe("hasToggleIntervention", () => {
  it("matches harnessAbDiffFields non-empty", () => {
    expect(hasToggleIntervention(baselineOnly, candidateOnly)).toBe(true);
    expect(hasToggleIntervention(identical, { ...identical, name: "x" })).toBe(false);
  });
});
