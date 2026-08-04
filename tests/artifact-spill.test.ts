import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ContentBlock } from "@anthropic-ai/sdk/resources/messages/messages.js";

import { registerDefaultSidecarHooks, resetSidecarHooks } from "../src/agent/hooks/index.js";
import { runToolUse } from "../src/agent/pipeline/runTool.js";
import { setWorkdir, artifactSpillThresholdBytes } from "../src/config.js";
import { FileArtifactStore, maybeSpillToolResult } from "../src/context/stores/index.js";
import { artifactMetaPath, artifactPath } from "../src/session/paths.js";
import { Session } from "../src/session/session.js";
import { parseItems } from "../src/session/io/index.js";
import { createTmpWorkdir, removeTmpWorkdir } from "./helpers/tmp-workdir.js";

let tmpDir = "";

beforeEach(() => {
  tmpDir = createTmpWorkdir("ocula-artifact-");
  setWorkdir(tmpDir);
  registerDefaultSidecarHooks(tmpDir);
});

afterEach(() => {
  resetSidecarHooks();
  removeTmpWorkdir(tmpDir);
  vi.unstubAllEnvs();
});

describe("maybeSpillToolResult", () => {
  it("returns content unchanged under threshold", async () => {
    const store = new FileArtifactStore(tmpDir);
    const content = "small output";
    const result = await maybeSpillToolResult("sess-1", "tu-1", content, store, tmpDir);
    expect(result.artifactId).toBeUndefined();
    expect(result.content).toBe(content);
  });

  it("spills oversized output to artifact store", async () => {
    vi.stubEnv("OCULA_ARTIFACT_SPILL_THRESHOLD_BYTES", "64");
    const store = new FileArtifactStore(tmpDir);
    const content = "x".repeat(200);
    const result = await maybeSpillToolResult("sess-1", "tu-1", content, store, tmpDir);

    expect(result.artifactId).toBeDefined();
    expect(result.content).toContain("[artifact:");
    expect(result.summary.byteCount).toBeGreaterThan(artifactSpillThresholdBytes());

    const artifact = await store.get("sess-1", result.artifactId!);
    expect(artifact?.byteCount).toBeGreaterThan(64);
    expect(fs.existsSync(artifactPath(tmpDir, "sess-1", result.artifactId!))).toBe(true);
    expect(fs.existsSync(artifactMetaPath(tmpDir, "sess-1", result.artifactId!))).toBe(true);
    expect(fs.readFileSync(artifactPath(tmpDir, "sess-1", result.artifactId!), "utf8")).toBe(content);
  });
});

describe("runToolUse artifact spill", () => {
  it("writes tool_outcome with artifactId for large results", async () => {
    vi.stubEnv("OCULA_ARTIFACT_SPILL_THRESHOLD_BYTES", "32");

    const session = Session.create(tmpDir);
    const stores = { artifacts: new FileArtifactStore(tmpDir) };
    const bigOutput = "y".repeat(500);

    vi.spyOn(await import("../src/tools/index.js"), "executeTool").mockResolvedValue(bigOutput);

    const block = {
      type: "tool_use" as const,
      id: "toolu_big",
      name: "read_file",
      input: { path: "big.txt" },
    };

    const result = await runToolUse(block, 1, {
      session,
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
    vi.stubEnv("OCULA_ARTIFACT_SPILL_THRESHOLD_BYTES", "32");
    const session = Session.create(tmpDir);
    const store = new FileArtifactStore(tmpDir);
    const content = "z".repeat(400);
    const spilled = await maybeSpillToolResult(session.sessionId, "tu-1", content, store, tmpDir);
    await session.appendToolOutcome(1, "tu-1", spilled.summary, spilled.artifactId);

    const reopened = Session.open(session.sessionId, tmpDir);
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
      fs.readFileSync(`${tmpDir}/.ocula/sessions/${session.sessionId}.jsonl`, "utf8").split("\n").filter(Boolean),
    );
    const outcome = logItems.find((item) => item.kind === "tool_outcome");
    expect(outcome?.kind).toBe("tool_outcome");
  });
});
