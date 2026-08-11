import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ContentBlock } from "@moontide/llm/protocol";

import { createSessionCommitPort } from "../packages/agent/src/agent/session-commit-port.js";
import { runToolUse } from "../packages/agent/src/agent/pipeline/index.js";
import { setWorkdir, artifactSpillThresholdBytes, toolPreviewChars, spillOptions } from "../packages/agent/src/config.js";
import { FileArtifactStore, maybeSpillToolResult } from "@moontide/session";
import { artifactMetaPath, artifactPath } from "@moontide/session";
import { Session } from "@moontide/session";
import { parseItems } from "@moontide/session";
import { clearTestRuntime, installTestRuntime } from "./helpers/test-runtime.js";
import { createTmpWorkdir, removeTmpWorkdir } from "./helpers/tmp-workdir.js";

let tmpDir = "";
let testRuntime: ReturnType<typeof installTestRuntime>;

beforeEach(() => {
  tmpDir = createTmpWorkdir("moontide-artifact-");
  setWorkdir(tmpDir);
  testRuntime = installTestRuntime(tmpDir);
});

afterEach(() => {
  clearTestRuntime();
  removeTmpWorkdir(tmpDir);
  vi.unstubAllEnvs();
});

describe("maybeSpillToolResult", () => {
  it("returns content and full summary under threshold", async () => {
    const store = new FileArtifactStore(tmpDir);
    const content = "line\n".repeat(80);
    const result = await maybeSpillToolResult("sess-1", "tu-1", content, store, tmpDir, spillOptions());
    expect(result.artifactId).toBeUndefined();
    expect(result.content).toBe(content);
    expect(result.summary.summary).toBe(content);
    expect(result.summary.truncated).toBe(false);
  });

  it("returns content unchanged under threshold", async () => {
    const store = new FileArtifactStore(tmpDir);
    const content = "small output";
    const result = await maybeSpillToolResult("sess-1", "tu-1", content, store, tmpDir, spillOptions());
    expect(result.artifactId).toBeUndefined();
    expect(result.content).toBe(content);
  });

  it("spills oversized output to artifact store", async () => {
    vi.stubEnv("MOONTIDE_ARTIFACT_SPILL_THRESHOLD_BYTES", "64");
    const store = new FileArtifactStore(tmpDir);
    const previewLimit = toolPreviewChars();
    const content = "x".repeat(previewLimit + 200);
    const result = await maybeSpillToolResult("sess-1", "tu-1", content, store, tmpDir, spillOptions());

    expect(result.artifactId).toBeDefined();
    expect(result.content).toContain("[artifact:");
    expect(result.summary.truncated).toBe(true);
    expect(result.summary.summary.length).toBeLessThanOrEqual(previewLimit);
    expect(result.summary.byteCount).toBeGreaterThan(artifactSpillThresholdBytes());

    const artifact = await store.get("sess-1", result.artifactId!);
    expect(artifact?.byteCount).toBeGreaterThan(64);
    expect(fs.existsSync(artifactPath(tmpDir, "sess-1", result.artifactId!))).toBe(true);
    expect(fs.existsSync(artifactMetaPath(tmpDir, "sess-1", result.artifactId!))).toBe(true);
    expect(fs.readFileSync(artifactPath(tmpDir, "sess-1", result.artifactId!), "utf8")).toBe(content);
  });
});

describe("toolPreviewChars", () => {
  it("derives preview as 20% of spill threshold when unset", () => {
    vi.stubEnv("MOONTIDE_ARTIFACT_SPILL_THRESHOLD_BYTES", "10000");
    delete process.env.MOONTIDE_TOOL_PREVIEW_CHARS;
    expect(toolPreviewChars()).toBe(2000);
  });

  it("defaults to 1638 when spill threshold is 8192", () => {
    delete process.env.MOONTIDE_TOOL_PREVIEW_CHARS;
    delete process.env.MOONTIDE_ARTIFACT_SPILL_THRESHOLD_BYTES;
    expect(toolPreviewChars()).toBe(1638);
  });

  it("honors explicit MOONTIDE_TOOL_PREVIEW_CHARS override", () => {
    vi.stubEnv("MOONTIDE_TOOL_PREVIEW_CHARS", "900");
    expect(toolPreviewChars()).toBe(900);
  });
});

describe("runToolUse artifact spill", () => {
  it("writes tool_outcome with artifactId for large results", async () => {
    vi.stubEnv("MOONTIDE_ARTIFACT_SPILL_THRESHOLD_BYTES", "32");

    const session = Session.create(tmpDir, createSessionCommitPort(tmpDir, testRuntime));
    const stores = { artifacts: new FileArtifactStore(tmpDir) };
    const bigOutput = "y".repeat(500);

    vi.spyOn(await import("../packages/agent/src/tools/index.js"), "executeTool").mockResolvedValue(bigOutput);

    const block = {
      type: "tool_use" as const,
      id: "toolu_big",
      name: "read_file",
      input: { path: "big.txt" },
    };

    const result = await runToolUse(block, 1, {
      session,
      runtime: testRuntime,
      stores: {
        artifacts: stores.artifacts,
        compaction: { get: async () => undefined, list: async () => [], save: async () => {} },
        checkpoints: { get: async () => undefined, list: async () => [], save: async () => {} },
      },
      userInteraction: {
        approveTool: async () => true,
        askQuestion: async () => [],
      },
    });

    expect(result.content).toContain("[artifact:");
    const items = await session.readItems();
    const outcome = items.find((item) => item.kind === "tool_outcome");
    expect(outcome?.kind).toBe("tool_outcome");
    if (outcome?.kind === "tool_outcome") {
      expect(outcome.artifactId).toBeDefined();
      expect(outcome.resultSummary.byteCount).toBeGreaterThan(32);
    }
  });
});

describe("session reload preserves artifact reference", () => {
  it("hydrates tool_result with artifact hint from item log", async () => {
    vi.stubEnv("MOONTIDE_ARTIFACT_SPILL_THRESHOLD_BYTES", "32");
    const session = Session.create(tmpDir, createSessionCommitPort(tmpDir, testRuntime));
    const store = new FileArtifactStore(tmpDir);
    const content = "z".repeat(400);
    const spilled = await maybeSpillToolResult(session.sessionId, "tu-1", content, store, tmpDir, spillOptions());
    await session.appendToolOutcome(1, "tu-1", spilled.summary, spilled.artifactId);

    const reopened = Session.open(session.sessionId, tmpDir, createSessionCommitPort(tmpDir, testRuntime));
    const messages = reopened.getMessages();
    const toolMessage = messages.find(
      (message) =>
        Array.isArray(message.content)
        && message.content.some((block: ContentBlock) => block.type === "tool_result"),
    );
    expect(toolMessage).toBeDefined();
    if (toolMessage && Array.isArray(toolMessage.content)) {
      const block = toolMessage.content.find((entry) => entry.type === "tool_result");
      if (block?.type === "tool_result") {
        expect(String(block.content)).toContain("[artifact:");
      }
    }

    const logItems = parseItems(
      fs.readFileSync(`${tmpDir}/.moontide/sessions/${session.sessionId}.jsonl`, "utf8").split("\n").filter(Boolean),
    );
    const outcome = logItems.find((item) => item.kind === "tool_outcome");
    expect(outcome?.kind).toBe("tool_outcome");
  });
});
