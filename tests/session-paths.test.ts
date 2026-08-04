import { describe, expect, it } from "vitest";

import {
  artifactPath,
  artifactsDir,
  checkpointPath,
  checkpointsDir,
  compactionDir,
  compactionSavePath,
  compactionSavePath,
  sessionLogPath,
  sessionIndexPath,
  sessionsDir,
} from "../src/session/paths.js";

const workdir = "/tmp/ocula-workspace";
const sessionId = "20260731-160000-a1b2c3d4";

describe("session paths", () => {
  it("builds session log path under .ocula/sessions", () => {
    expect(sessionsDir(workdir)).toBe("/tmp/ocula-workspace/.ocula/sessions");
    expect(sessionLogPath(workdir, sessionId)).toBe(
      `/tmp/ocula-workspace/.ocula/sessions/${sessionId}.jsonl`,
    );
    expect(sessionIndexPath(workdir)).toBe("/tmp/ocula-workspace/.ocula/sessions/index.json");
  });

  it("builds artifact and store subpaths", () => {
    expect(artifactsDir(workdir, sessionId)).toBe(
      `/tmp/ocula-workspace/.ocula/artifacts/${sessionId}`,
    );
    expect(artifactPath(workdir, sessionId, "art-1")).toBe(
      `/tmp/ocula-workspace/.ocula/artifacts/${sessionId}/art-1`,
    );
    expect(compactionDir(workdir, sessionId)).toBe(
      `/tmp/ocula-workspace/.ocula/sessions/${sessionId}/compaction`,
    );
    expect(compactionSavePath(workdir, sessionId, "cmp-1")).toBe(
      `/tmp/ocula-workspace/.ocula/sessions/${sessionId}/compaction/cmp-1.json`,
    );
    expect(compactionSavePath(workdir, sessionId, "cmp-1")).toBe(
      `/tmp/ocula-workspace/.ocula/sessions/${sessionId}/compaction/cmp-1.json`,
    );
    expect(checkpointsDir(workdir, sessionId)).toBe(
      `/tmp/ocula-workspace/.ocula/sessions/${sessionId}/checkpoints`,
    );
    expect(checkpointPath(workdir, sessionId, "ckpt-1")).toBe(
      `/tmp/ocula-workspace/.ocula/sessions/${sessionId}/checkpoints/ckpt-1.json`,
    );
  });
});
