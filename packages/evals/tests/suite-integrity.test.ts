import fs from "node:fs";
import { describe, expect, it } from "vitest";

import { listSuiteFiles, loadSuite, suitePath } from "../src/suite-loader.js";

const EXPECTED_COUNTS: Record<string, number> = {
  coding: 10,
  exploration: 10,
  deep_task: 10,
  general: 10,
  regression: 8,
  external_research: 10,
};

describe("suite integrity v2", () => {
  const categories = listSuiteFiles("v2");

  it("matches manifest categories", () => {
    const manifest = JSON.parse(
      fs.readFileSync(suitePath("v2/manifest.json"), "utf8"),
    ) as { categories: Record<string, unknown> };
    for (const category of categories) {
      const name = category.split("/")[1]!;
      expect(manifest.categories[name]).toBeTruthy();
    }
  });

  it("has unique case ids within each category", () => {
    for (const category of categories) {
      const suite = loadSuite(category);
      const ids = suite.cases.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("requires expectedChecks on objective cases", () => {
    for (const category of categories) {
      const suite = loadSuite(category);
      for (const caseDef of suite.cases) {
        if (caseDef.gradingMode === "objective") {
          expect(caseDef.expectedChecks?.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("has expected case counts", () => {
    for (const category of categories) {
      const name = category.split("/")[1]!;
      const suite = loadSuite(category);
      expect(suite.cases).toHaveLength(EXPECTED_COUNTS[name]);
    }
  });

  it("requires http recordings for external_research", () => {
    const suite = loadSuite("v2/external_research");
    for (const caseDef of suite.cases) {
      expect(caseDef.httpFixturesPath).toBeTruthy();
      expect(fs.existsSync(caseDef.httpFixturesPath!)).toBe(true);
    }
  });
});
