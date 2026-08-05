import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setWorkdir } from "../src/config.js";
import { executeTool } from "../src/tools/index.js";
import { TOOL_NAMES } from "../src/tools/names.js";
import { FileArtifactStore, maybeSpillToolResult } from "../src/session/stores/index.js";
import { clearTestRuntime, getTestRuntime, installTestRuntime } from "./helpers/test-runtime.js";
import { createTmpWorkdir, removeTmpWorkdir } from "./helpers/tmp-workdir.js";

let tmpDir = "";

beforeEach(() => {
  tmpDir = createTmpWorkdir("moontide-read-artifact-");
  setWorkdir(tmpDir);
  installTestRuntime(tmpDir);
});

afterEach(() => {
  clearTestRuntime();
  removeTmpWorkdir(tmpDir);
  vi.unstubAllEnvs();
});

describe("read_artifact", () => {
  it("returns full spilled content for the current session", async () => {
    vi.stubEnv("MOONTIDE_ARTIFACT_SPILL_THRESHOLD_BYTES", "32");
    const store = new FileArtifactStore(tmpDir);
    const content = "full tool output\n".repeat(40);
    const spilled = await maybeSpillToolResult("sess-1", "tu-1", content, store, tmpDir);

    const raw = await executeTool(
      TOOL_NAMES.READ_ARTIFACT,
      { artifact_id: spilled.artifactId },
      {
        workdir: tmpDir,
        sessionId: "sess-1",
        userInteraction: { approveTool: async () => true, askQuestion: async () => [] },
        runtime: { tools: getTestRuntime().tools },
      },
    );

    const parsed = JSON.parse(raw) as {
      status: string;
      artifact_id: string;
      byte_count: number;
      content: string;
    };
    expect(parsed.status).toBe("ok");
    expect(parsed.artifact_id).toBe(spilled.artifactId);
    expect(parsed.content).toBe(content);
    expect(parsed.byte_count).toBeGreaterThan(32);
  });

  it("errors when session_id is missing", async () => {
    const raw = await executeTool(
      TOOL_NAMES.READ_ARTIFACT,
      { artifact_id: "art-1" },
      {
        workdir: tmpDir,
        userInteraction: { approveTool: async () => true, askQuestion: async () => [] },
        runtime: { tools: getTestRuntime().tools },
      },
    );

    expect(JSON.parse(raw)).toEqual({
      status: "error",
      error: "session_id required for read_artifact",
    });
  });

  it("errors when artifact_id is empty", async () => {
    const raw = await executeTool(
      TOOL_NAMES.READ_ARTIFACT,
      { artifact_id: "  " },
      {
        workdir: tmpDir,
        sessionId: "sess-1",
        userInteraction: { approveTool: async () => true, askQuestion: async () => [] },
        runtime: { tools: getTestRuntime().tools },
      },
    );

    expect(JSON.parse(raw)).toEqual({
      status: "error",
      error: "artifact_id is required",
    });
  });

  it("errors when artifact file is missing", async () => {
    const raw = await executeTool(
      TOOL_NAMES.READ_ARTIFACT,
      { artifact_id: "missing-id" },
      {
        workdir: tmpDir,
        sessionId: "sess-1",
        userInteraction: { approveTool: async () => true, askQuestion: async () => [] },
        runtime: { tools: getTestRuntime().tools },
      },
    );

    const parsed = JSON.parse(raw) as { status: string; error: string };
    expect(parsed.status).toBe("error");
    expect(parsed.error.length).toBeGreaterThan(0);
  });
});
