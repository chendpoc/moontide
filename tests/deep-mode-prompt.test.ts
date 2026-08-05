import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  applyDeepPromptGate,
  getActiveWorkMemId,
  isDeepModeEnabled,
  resetDeepModeOnNewSession,
} from "../src/agent/deep-mode.js";
import { setWorkdir } from "../src/config.js";
import { readWorkMemEvents } from "../src/plugins/builtin/work-mem/store.js";
import { registerDefaultTools } from "../src/tools/register-defaults.js";
import { defineWorkMemTools } from "../src/plugins/builtin/work-mem/tools.js";
import { ToolRegistry } from "../src/tools/registry.js";

describe("Deep Task Mode prompt gate", () => {
  let workdir: string;

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "moontide-deep-mode-"));
    setWorkdir(workdir);
    resetDeepModeOnNewSession();
  });

  afterEach(() => {
    resetDeepModeOnNewSession();
    rmSync(workdir, { recursive: true, force: true });
  });

  it("does not activate without deep: prefix", () => {
    const result = applyDeepPromptGate("fix the bug", "sess-1");
    expect(result.deepActivated).toBe(false);
    expect(result.prompt).toBe("fix the bug");
    expect(isDeepModeEnabled()).toBe(false);
    expect(defineWorkMemTools()).toBeNull();
  });

  it("strips deep: prefix and starts task", () => {
    const result = applyDeepPromptGate("deep: investigate flaky test", "sess-1");
    expect(result.deepActivated).toBe(true);
    expect(result.prompt).toBe("investigate flaky test");
    expect(isDeepModeEnabled()).toBe(true);
    const workMemId = getActiveWorkMemId("sess-1");
    expect(workMemId).toMatch(/^wm_[a-f0-9]{8}$/);
    const events = readWorkMemEvents(workdir, "sess-1", workMemId!);
    expect(events[0]).toMatchObject({
      kind: "workmem_started",
      goal: "investigate flaky test",
    });
    expect(events[1]).toMatchObject({
      kind: "workmem_draft",
      draftKind: "outline",
    });
    expect(events[1]?.kind === "workmem_draft" ? events[1].content : "").toContain(
      "investigate flaky test",
    );
  });

  it("is case-insensitive on deep: prefix", () => {
    const result = applyDeepPromptGate("Deep: compare caches", "sess-2");
    expect(result.prompt).toBe("compare caches");
    expect(result.deepActivated).toBe(true);
  });

  it("creates new workMemId on each deep: prompt", () => {
    applyDeepPromptGate("deep: first task", "sess-3");
    const first = getActiveWorkMemId("sess-3");
    applyDeepPromptGate("deep: second task", "sess-3");
    const second = getActiveWorkMemId("sess-3");
    expect(first).not.toBe(second);
  });

  it("registers work_mem after refresh when deep mode active", () => {
    applyDeepPromptGate("deep: task", "sess-4");
    const registry = new ToolRegistry();
    registry.refresh();
    expect(registry.getTool("work_mem")).toBeDefined();
    const names = registerDefaultTools().map((tool) => tool.schema.name);
    expect(names).toContain("work_mem");
  });

  it("reset clears deep mode", () => {
    applyDeepPromptGate("deep: task", "sess-5");
    resetDeepModeOnNewSession();
    expect(isDeepModeEnabled()).toBe(false);
    expect(getActiveWorkMemId("sess-5")).toBeUndefined();
  });
});
