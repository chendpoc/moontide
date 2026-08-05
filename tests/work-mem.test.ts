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
import { runWorkMem } from "../src/plugins/builtin/work-mem/handler.js";
import { readWorkMemEvents } from "../src/plugins/builtin/work-mem/store.js";
import { workMemPath } from "../src/session/paths.js";

describe("work_mem handler", () => {
  let workdir: string;
  const sessionId = "sess-work-mem";

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "moontide-work-mem-"));
    setWorkdir(workdir);
    resetDeepModeOnNewSession();
    applyDeepPromptGate("deep: debug auth", sessionId);
  });

  afterEach(() => {
    resetDeepModeOnNewSession();
    rmSync(workdir, { recursive: true, force: true });
  });

  it("rejects when deep mode is off", () => {
    resetDeepModeOnNewSession();
    const raw = runWorkMem({ action: "note", content: "x" }, { workdir, sessionId });
    const result = JSON.parse(raw) as { status: string; error: string };
    expect(result.status).toBe("error");
    expect(result.error).toContain("Deep Task Mode");
  });

  it("appends draft and note then summarizes", () => {
    const workMemId = getActiveWorkMemId(sessionId)!;

    const draftRaw = runWorkMem(
      { action: "draft", kind: "outline", content: "Reproduce login failure" },
      { workdir, sessionId },
    );
    expect(JSON.parse(draftRaw)).toMatchObject({ status: "ok", workMemId, active: true });

    const noteRaw = runWorkMem(
      { action: "note", content: "401 on refresh token", ref: "grep-auth" },
      { workdir, sessionId },
    );
    expect(JSON.parse(noteRaw)).toMatchObject({ status: "ok" });

    const summaryRaw = runWorkMem({ action: "summarize" }, { workdir, sessionId });
    const summary = JSON.parse(summaryRaw) as {
      status: string;
      text: string;
      packTier: string;
    };
    expect(summary.status).toBe("ok");
    expect(summary.packTier).toBe("normal");
    expect(summary.text).toContain("Reproduce login failure");
    expect(summary.text).toContain("401 on refresh token");

    const events = readWorkMemEvents(workdir, sessionId, workMemId);
    expect(events.some((event) => event.kind === "workmem_summary")).toBe(true);
  });

  it("refine writes compact pack event", () => {
    const workMemId = getActiveWorkMemId(sessionId)!;
    runWorkMem({ action: "draft", kind: "decision", content: "Use redis sessions" }, {
      workdir,
      sessionId,
    });
    const refineRaw = runWorkMem({ action: "refine", reason: "budget" }, { workdir, sessionId });
    const refine = JSON.parse(refineRaw) as { packTier: string; text: string };
    expect(refine.packTier).toBe("compact");
    expect(refine.text).toContain("Use redis sessions");

    const events = readWorkMemEvents(workdir, sessionId, workMemId);
    expect(events.some((event) => event.kind === "workmem_refine")).toBe(true);
  });

  it("persists jsonl at expected path", () => {
    const workMemId = getActiveWorkMemId(sessionId)!;
    expect(workMemPath(workdir, sessionId, workMemId)).toContain(
      `.moontide/sessions/${sessionId}/work-mem/${workMemId}.jsonl`,
    );
  });

  it("follow-up without deep: prefix writes to the same active jsonl", () => {
    const workMemId = getActiveWorkMemId(sessionId)!;
    runWorkMem({ action: "note", content: "first note" }, { workdir, sessionId });

    expect(isDeepModeEnabled()).toBe(true);
    runWorkMem({ action: "note", content: "follow-up note" }, { workdir, sessionId });
    expect(getActiveWorkMemId(sessionId)).toBe(workMemId);

    const events = readWorkMemEvents(workdir, sessionId, workMemId);
    expect(events.filter((event) => event.kind === "workmem_note")).toHaveLength(2);
    expect(events.some((event) => event.kind === "workmem_note" && event.content === "follow-up note")).toBe(
      true,
    );
  });
});
