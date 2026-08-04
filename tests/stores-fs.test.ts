import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  FileArtifactStore,
  FileCheckpointStore,
  FileCompactionStore,
  createSessionStores,
} from "../src/context/stores/index.js";
import type { Artifact } from "../src/context/stores/artifact-types.js";
import type { Checkpoint } from "../src/context/stores/checkpoint-types.js";
import type { CompactionSave } from "../src/context/stores/compaction-types.js";
import { artifactMetaPath, checkpointPath, compactionSavePath } from "../src/session/paths.js";
import { createTmpWorkdir, removeTmpWorkdir } from "./helpers/tmp-workdir.js";

let tmpDir = "";
const sessionId = "20260731-160000-a1b2c3d4";

beforeEach(() => {
  tmpDir = createTmpWorkdir("ocula-stores-");
});

afterEach(() => {
  removeTmpWorkdir(tmpDir);
});

describe("FileCompactionStore", () => {
  it("saves, gets, and lists compaction saves", async () => {
    const store = new FileCompactionStore(tmpDir);
    const save: CompactionSave = {
      id: "cmp-1",
      sessionId,
      createdAtTurn: 2,
      kind: "summary",
      coversItemIds: ["e1", "e2"],
      payload: { text: "rolled up" },
    };

    await store.save(save);
    expect(fs.existsSync(compactionSavePath(tmpDir, sessionId, "cmp-1"))).toBe(true);

    const loaded = await store.get(sessionId, "cmp-1");
    expect(loaded).toEqual(save);

    const second: CompactionSave = {
      ...save,
      id: "cmp-2",
      createdAtTurn: 4,
    };
    await store.save(second);

    const list = await store.list(sessionId);
    expect(list.map((item) => item.id)).toEqual(["cmp-1", "cmp-2"]);
  });
});

describe("FileCheckpointStore", () => {
  it("saves, gets, and lists checkpoints", async () => {
    const store = new FileCheckpointStore(tmpDir);
    const checkpoint: Checkpoint = {
      id: "ckpt-1",
      sessionId,
      createdAtTurn: 5,
      lastItemId: "e9",
      instructionEpoch: 1,
      activeCompactionSaveId: "cmp-1",
    };

    await store.save(checkpoint);
    expect(fs.existsSync(checkpointPath(tmpDir, sessionId, "ckpt-1"))).toBe(true);

    expect(await store.get(sessionId, "ckpt-1")).toEqual(checkpoint);

    const list = await store.list(sessionId);
    expect(list).toHaveLength(1);
    expect(list[0]?.lastItemId).toBe("e9");
  });
});

describe("FileArtifactStore", () => {
  it("puts and gets artifact metadata", async () => {
    const store = new FileArtifactStore(tmpDir);
    const artifact: Artifact = {
      id: "art-1",
      sessionId,
      toolUseId: "tu-1",
      contentType: "text",
      path: `.ocula/artifacts/${sessionId}/art-1`,
      byteCount: 42,
      createdAt: "2026-07-31T08:00:00.000Z",
    };

    await store.put(artifact);
    expect(fs.existsSync(artifactMetaPath(tmpDir, sessionId, "art-1"))).toBe(true);
    expect(await store.get(sessionId, "art-1")).toEqual(artifact);
  });
});

describe("createSessionStores", () => {
  it("returns file-backed stores", () => {
    const stores = createSessionStores(tmpDir);
    expect(stores.compaction).toBeInstanceOf(FileCompactionStore);
    expect(stores.checkpoints).toBeInstanceOf(FileCheckpointStore);
    expect(stores.artifacts).toBeInstanceOf(FileArtifactStore);
  });
});
