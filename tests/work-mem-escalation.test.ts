import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  applyDeepPromptGate,
  getActiveWorkMemId,
  resetDeepModeOnNewSession,
} from "../packages/agent/src/agent/deep-mode.js";
import { setWorkdir } from "../packages/agent/src/config.js";
import {
  estimatePackTokens,
  resolveWorkingSetSnapshot,
  runWorkMem,
  WORK_MEM_CAP_NORMAL,
} from "@moontide/tools";

describe("work_mem budget escalation", () => {
  let workdir: string;
  const sessionId = "sess-escalation";
  const contextWindow = 128_000;

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "moontide-work-mem-escalation-"));
    setWorkdir(workdir);
    resetDeepModeOnNewSession();
    applyDeepPromptGate("deep: large investigation", sessionId);
  });

  afterEach(() => {
    resetDeepModeOnNewSession();
    rmSync(workdir, { recursive: true, force: true });
  });

  it("returns normal stage for small working set", () => {
    runWorkMem({ action: "draft", kind: "outline", content: "Small task" }, {
      workdir,
      sessionId,
    });
    const workMemId = getActiveWorkMemId(sessionId)!;
    const resolved = resolveWorkingSetSnapshot({ workdir, sessionId, workMemId, contextWindow });
    expect(resolved.stage).toBe("normal");
    expect(resolved.budgetTier).toBe("normal");
    expect(resolved.text).toContain("Small task");
  });

  it("escalates to refined_at_normal when compact fits normal cap", () => {
    const note = "n".repeat(7000);
    for (let i = 0; i < 5; i += 1) {
      runWorkMem({ action: "note", content: `${note}-${i}` }, { workdir, sessionId });
    }

    const workMemId = getActiveWorkMemId(sessionId)!;
    const resolved = resolveWorkingSetSnapshot({ workdir, sessionId, workMemId, contextWindow });
    expect(resolved.stage).toBe("refined_at_normal");
    expect(resolved.budgetTier).toBe("normal");
    expect(estimatePackTokens(resolved.text)).toBeLessThanOrEqual(WORK_MEM_CAP_NORMAL);
  });

  it("escalates to cap_upgraded when compact exceeds normal cap but fits 10pct window", () => {
    const note = "m".repeat(20_000);
    runWorkMem({ action: "note", content: note }, { workdir, sessionId });
    runWorkMem({ action: "note", content: note }, { workdir, sessionId });

    const workMemId = getActiveWorkMemId(sessionId)!;
    const resolved = resolveWorkingSetSnapshot({ workdir, sessionId, workMemId, contextWindow });
    expect(resolved.stage).toBe("cap_upgraded");
    expect(resolved.budgetTier).toBe("upgraded");
    expect(estimatePackTokens(resolved.text)).toBeGreaterThan(WORK_MEM_CAP_NORMAL);
    expect(estimatePackTokens(resolved.text)).toBeLessThanOrEqual(
      Math.floor(contextWindow * 0.1),
    );
  });

  it("escalates to emergency when content exceeds upgraded cap", () => {
    const huge = "x".repeat(50_000);
    runWorkMem({ action: "note", content: huge }, { workdir, sessionId });
    runWorkMem({ action: "note", content: huge }, { workdir, sessionId });

    const workMemId = getActiveWorkMemId(sessionId)!;
    const resolved = resolveWorkingSetSnapshot({ workdir, sessionId, workMemId, contextWindow });
    expect(["cap_upgraded", "emergency"]).toContain(resolved.stage);
    expect(resolved.budgetTier).toBe("upgraded");
    expect(estimatePackTokens(resolved.text)).toBeLessThanOrEqual(
      Math.floor(contextWindow * 0.1) + 500,
    );
  });

  it("honors minStage refined_at_normal for compaction pressure", () => {
    runWorkMem({ action: "draft", kind: "outline", content: "Stable outline" }, {
      workdir,
      sessionId,
    });
    const resolvedNormal = resolveWorkingSetSnapshot({ workdir, sessionId, workMemId: getActiveWorkMemId(sessionId)!, contextWindow });
    expect(resolvedNormal.stage).toBe("normal");

    const resolvedCompact = resolveWorkingSetSnapshot({
      workdir,
      sessionId,
      workMemId: getActiveWorkMemId(sessionId)!,
      contextWindow,
      minStage: "refined_at_normal",
    });
    expect(resolvedCompact.stage).toBe("refined_at_normal");
    expect(resolvedCompact.text).toContain("Stable outline");
  });

  it("does not apply when deep mode reset", () => {
    resetDeepModeOnNewSession();
    expect(getActiveWorkMemId(sessionId)).toBeUndefined();
  });

  it("normal cap constant is 8000", () => {
    expect(WORK_MEM_CAP_NORMAL).toBe(8000);
  });
});
