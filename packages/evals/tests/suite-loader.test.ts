import fs from "node:fs";
import { describe, expect, it } from "vitest";

import { listSuiteFiles, loadSuite, suitePath } from "../src/suite-loader.js";

const V2_COUNTS: Record<string, number> = {
  coding: 10,
  exploration: 10,
  deep_task: 10,
  general: 10,
  regression: 8,
  external_research: 10,
};

describe("suite v1 fixtures", () => {
  const files = listSuiteFiles("v1");

  it("loads every v1 suite file", () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const file of files) {
      const suite = loadSuite(file);
      expect(suite.cases.length).toBeGreaterThan(0);
    }
  });

  it("has ten cases per category file", () => {
    for (const file of files) {
      const suite = loadSuite(file);
      expect(suite.cases).toHaveLength(10);
    }
  });
});

describe("suite v2 agent-native cases", () => {
  const categories = listSuiteFiles("v2");

  it("lists category directories", () => {
    expect(categories).toEqual([
      "v2/coding",
      "v2/deep_task",
      "v2/exploration",
      "v2/external_research",
      "v2/general",
      "v2/regression",
    ]);
  });

  it("loads expected case counts", () => {
    for (const category of categories) {
      const name = category.split("/")[1]!;
      const suite = loadSuite(category);
      expect(suite.cases).toHaveLength(V2_COUNTS[name]);
    }
  });

  it("tags every case with featureSurface", () => {
    for (const category of categories) {
      const suite = loadSuite(category);
      for (const caseDef of suite.cases) {
        expect(caseDef.featureSurface?.length).toBeGreaterThan(0);
      }
    }
  });

  it("keeps coding off model_only-only guard cases", () => {
    const suite = loadSuite("v2/coding");
    for (const caseDef of suite.cases) {
      expect(caseDef.featureSurface).not.toEqual(["model_only"]);
    }
  });

  it("loads fixture dirs for coding", () => {
    const suite = loadSuite("v2/coding");
    const trace = suite.cases.find((c) => c.id === "coding-tool-multi-read-trace");
    expect(trace?.setup?.files?.["src/handlers/users.ts"]).toContain("handleCreateUser");
  });

  it("loads shared workspace for exploration", () => {
    const suite = loadSuite("v2/exploration");
    const probe = suite.cases.find((c) => c.id === "explore-grep-hardcoded-secret");
    expect(probe?.setup?.files?.["config/secrets.ts"]).toContain("sk_live_");
    expect(fs.existsSync(suitePath("v2/exploration/workspace"))).toBe(true);
  });

  it("includes tool and deep protocol checks", () => {
    const coding = loadSuite("v2/coding");
    const grepCase = coding.cases.find((c) => c.id === "coding-tool-grep-secret");
    expect(grepCase?.expectedChecks?.some((c) => c.kind === "tool_called")).toBe(true);

    const deep = loadSuite("v2/deep_task");
    const memCase = deep.cases.find((c) => c.id === "deep-work-mem-outline-first");
    expect(memCase?.expectLift).toBe(true);
    expect(memCase?.expectedChecks?.some((c) => c.kind === "work_mem_used")).toBe(true);
  });

  it("loads http fixtures for external_research", () => {
    const suite = loadSuite("v2/external_research");
    for (const caseDef of suite.cases) {
      expect(caseDef.httpFixturesPath).toBeTruthy();
      expect(fs.existsSync(caseDef.httpFixturesPath!)).toBe(true);
    }
  });
});
