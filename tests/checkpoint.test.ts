import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { registerDefaultSidecarHooks, resetSidecarHooks } from "../src/agent/hooks/index.js";
import { AgentSession } from "../src/agent/agent-session.js";
import { composeContext } from "../src/context/composer/compose.js";
import { defaultCompactionPolicy } from "../src/context/composer/compaction/policy.js";
import {
  createStubArtifactStore,
  createStubCompactionStore,
  FileCheckpointStore,
} from "../src/context/stores/index.js";
import { setWorkdir } from "../src/config.js";
import { checkpointPath } from "../src/session/paths.js";
import { resolveToolDefinitions } from "../src/context/composer/tool-definitions/index.js";
import { createTmpWorkdir, removeTmpWorkdir } from "./helpers/tmp-workdir.js";

let tmpDir = "";

beforeEach(() => {
  tmpDir = createTmpWorkdir("ocula-checkpoint-");
  setWorkdir(tmpDir);
  registerDefaultSidecarHooks(tmpDir);
});

afterEach(() => {
  resetSidecarHooks();
  removeTmpWorkdir(tmpDir);
});

describe("AgentSession checkpoint", () => {
  it("creates checkpoint and writes item log marker", async () => {
    const agent = AgentSession.create(tmpDir);
    await agent.session.appendUser(1, "hello");
    await agent.session.appendUser(2, "follow up");

    const messages = agent.session.getMessages();
    const checkpoint = await agent.createCheckpoint(2, "before refactor");

    expect(checkpoint.lastItemId).toBe(messages.at(-1)?.id);
    expect(fs.existsSync(checkpointPath(tmpDir, agent.session.sessionId, checkpoint.id))).toBe(true);

    const items = await agent.session.readItems();
    expect(items.some((item) => item.kind === "checkpoint_created")).toBe(true);
  });

  it("resume truncates visible messages without deleting item log", async () => {
    const agent = AgentSession.create(tmpDir);
    await agent.session.appendUser(1, "first");
    const firstId = agent.session.getMessages()[0]!.id;
    await agent.session.appendUser(2, "second");
    await agent.session.appendUser(3, "third");

    const checkpoint = await agent.createCheckpoint(3);
    expect(agent.session.getMessages()).toHaveLength(3);

    await agent.session.appendUser(4, "fourth");
    expect(agent.session.getMessages()).toHaveLength(4);

    const ok = await agent.resume(checkpoint.id);
    expect(ok).toBe(true);
    expect(agent.session.getMessages()).toHaveLength(3);
    expect(agent.session.getMessages().map((message) => message.id)).toContain(firstId);

    const items = await agent.session.readItems();
    expect(items.filter((item) => item.kind === "user_message")).toHaveLength(4);
  });

  it("composeContext respects resumeFromCheckpointId", async () => {
    const agent = AgentSession.create(tmpDir);
    await agent.session.appendUser(1, "a");
    await agent.session.appendUser(2, "b");
    const checkpoint = await agent.createCheckpoint(2);
    await agent.session.appendUser(3, "c");
    await agent.resume(checkpoint.id);

    const composed = await composeContext({
      sessionId: agent.session.sessionId,
      turn: 4,
      messages: agent.session.getMessages(),
      instructionState: { basePrompt: "sys", epoch: 1 },
      artifactStore: createStubArtifactStore(),
      compactionStore: createStubCompactionStore(),
      checkpointStore: new FileCheckpointStore(tmpDir),
      toolDefinitions: resolveToolDefinitions(),
      modelProfile: {
        logicalModelId: "test",
        contextWindow: 200_000,
        maxOutputTokens: 8192,
        supportsTools: true,
        supportsThinking: false,
        tokenCount: "estimate",
      },
      compactionPolicy: { ...defaultCompactionPolicy, autoEnabled: false },
      resumeFromCheckpointId: checkpoint.id,
    });

    expect(composed.manifest.includedItemIds).toHaveLength(2);
    expect(composed.manifest.resumeCheckpointId).toBe(checkpoint.id);
  });

  it("open with resumeFromCheckpointId hydrates truncated messages", async () => {
    const agent = AgentSession.create(tmpDir);
    await agent.session.appendUser(1, "one");
    await agent.session.appendUser(2, "two");
    const checkpoint = await agent.createCheckpoint(2);
    await agent.session.appendUser(3, "three");
    const sessionId = agent.session.sessionId;

    const reopened = await AgentSession.open(sessionId, tmpDir, {
      resumeFromCheckpointId: checkpoint.id,
    });

    expect(reopened.session.getMessages()).toHaveLength(2);
    expect(reopened.getResumeCheckpointId()).toBe(checkpoint.id);
  });
});
