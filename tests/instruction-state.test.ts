import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildSystemFromInstructionState } from "@moontide/context-composer";
import { loadProjectRules, resolveInstructionState } from "../packages/agent/src/instruction-state/index.js";
import { dataPath, joinPath } from "@moontide/shared/utils/path.js";
import { createTmpWorkdir, removeTmpWorkdir } from "./helpers/tmp-workdir.js";

let tmpDir = "";

beforeEach(() => {
  tmpDir = createTmpWorkdir("moontide-instruction-");
});

afterEach(() => {
  removeTmpWorkdir(tmpDir);
});

describe("instruction-state", () => {
  it("loads AGENTS.md into projectRules", () => {
    fs.writeFileSync(joinPath(tmpDir, "AGENTS.md"), "Always run tests before commit.", "utf8");

    const state = resolveInstructionState(tmpDir);

    expect(state.projectRules).toContain("Always run tests");
    expect(state.epoch).toBeGreaterThan(1);
    expect(buildSystemFromInstructionState(state)).toContain("Always run tests");
  });

  it("loads .moontide/rules/*.md after project instruction files", () => {
    fs.writeFileSync(joinPath(tmpDir, "AGENTS.md"), "Base agents", "utf8");
    const rulesDir = dataPath(tmpDir, "rules");
    fs.mkdirSync(rulesDir, { recursive: true });
    fs.writeFileSync(joinPath(rulesDir, "style.md"), "Use kebab-case.", "utf8");

    const rules = loadProjectRules(tmpDir);

    expect(rules).toContain("Base agents");
    expect(rules).toContain("Use kebab-case.");
  });

  it("returns epoch 1 when no project rules exist", () => {
    const state = resolveInstructionState(tmpDir);
    expect(state.projectRules).toBeUndefined();
    expect(state.epoch).toBe(1);
  });

  it("caches instruction state within a run", () => {
    fs.writeFileSync(joinPath(tmpDir, "AGENTS.md"), "cached rules", "utf8");
    const first = resolveInstructionState(tmpDir);
    fs.writeFileSync(joinPath(tmpDir, "AGENTS.md"), "changed on disk", "utf8");
    const second = resolveInstructionState(tmpDir);
    expect(second).toBe(first);
    expect(second.projectRules).toContain("cached rules");
  });
});
