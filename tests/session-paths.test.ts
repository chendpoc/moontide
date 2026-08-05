import { describe, expect, it } from "vitest";

import {
  artifactPath,
  artifactsDir,
  checkpointPath,
  checkpointsDir,
  compactionDir,
  compactionSavePath,
  sessionLogPath,
  sessionIndexPath,
  sessionsDir,
  workMemDir,
  workMemPath,
} from "../src/session/paths.js";

const workdir = "/tmp/moontide-workspace";
const sessionId = "20260731-160000-a1b2c3d4";

describe("session paths", () => {
  it("builds session log path under .moontide/sessions", () => {
    expect(sessionsDir(workdir)).toBe("/tmp/moontide-workspace/.moontide/sessions");
    expect(sessionLogPath(workdir, sessionId)).toBe(
      `/tmp/moontide-workspace/.moontide/sessions/${sessionId}.jsonl`,
    );
    expect(sessionIndexPath(workdir)).toBe("/tmp/moontide-workspace/.moontide/sessions/index.json");
  });

  it("builds artifact and store subpaths", () => {
    expect(artifactsDir(workdir, sessionId)).toBe(
      `/tmp/moontide-workspace/.moontide/artifacts/${sessionId}`,
    );
    expect(artifactPath(workdir, sessionId, "art-1")).toBe(
      `/tmp/moontide-workspace/.moontide/artifacts/${sessionId}/art-1`,
    );
    expect(compactionDir(workdir, sessionId)).toBe(
      `/tmp/moontide-workspace/.moontide/sessions/${sessionId}/compaction`,
    );
    expect(compactionSavePath(workdir, sessionId, "cmp-1")).toBe(
      `/tmp/moontide-workspace/.moontide/sessions/${sessionId}/compaction/cmp-1.json`,
    );
    expect(checkpointsDir(workdir, sessionId)).toBe(
      `/tmp/moontide-workspace/.moontide/sessions/${sessionId}/checkpoints`,
    );
    expect(checkpointPath(workdir, sessionId, "ckpt-1")).toBe(
      `/tmp/moontide-workspace/.moontide/sessions/${sessionId}/checkpoints/ckpt-1.json`,
    );
  });

  it("builds work-mem paths under session", () => {
    expect(workMemDir(workdir, sessionId)).toBe(
      `/tmp/moontide-workspace/.moontide/sessions/${sessionId}/work-mem`,
    );
    expect(workMemPath(workdir, sessionId, "wm_abc12345")).toBe(
      `/tmp/moontide-workspace/.moontide/sessions/${sessionId}/work-mem/wm_abc12345.jsonl`,
    );
  });
});
