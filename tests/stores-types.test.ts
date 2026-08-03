import { describe, expect, it } from "vitest";

import type { Artifact } from "../src/context/stores/artifact-types.js";
import type { Checkpoint } from "../src/context/stores/checkpoint-types.js";
import type { CompactionRecord } from "../src/context/stores/compaction-types.js";
import { isSessionLog } from "../src/session/log-types.js";

describe("stores types", () => {
  it("accepts artifact shape", () => {
    const artifact: Artifact = {
      id: "art-1",
      sessionId: "sess-1",
      toolUseId: "tu-1",
      contentType: "text",
      path: ".ocula/artifacts/sess-1/art-1",
      byteCount: 12,
      createdAt: "2026-07-31T08:00:00.000Z",
    };
    expect(artifact.contentType).toBe("text");
  });

  it("accepts compaction record shape", () => {
    const record: CompactionRecord = {
      id: "cmp-1",
      sessionId: "sess-1",
      createdAtTurn: 3,
      kind: "summary",
      coversEntryIds: ["e1", "e2"],
      payload: { text: "summary text" },
    };
    expect(record.kind).toBe("summary");
  });

  it("accepts checkpoint shape", () => {
    const checkpoint: Checkpoint = {
      id: "chk-1",
      sessionId: "sess-1",
      createdAtTurn: 5,
      lastEntryId: "e9",
      instructionEpoch: 1,
    };
    expect(checkpoint.lastEntryId).toBe("e9");
  });
});

describe("session log NDJSON fixture", () => {
  it("parses spec-style user and assistant entries", () => {
    const lines = [
      {
        id: "e1",
        sessionId: "20260730-120000-abcd1234",
        turn: 1,
        at: "2026-07-30T12:00:01.000Z",
        kind: "user_message",
        text: "hello",
      },
      {
        id: "e2",
        sessionId: "20260730-120000-abcd1234",
        turn: 1,
        at: "2026-07-30T12:00:02.000Z",
        kind: "assistant_message",
        blocks: [{ type: "text", text: "hi there" }],
      },
    ];

    for (const entry of lines) {
      expect(isSessionLog(entry)).toBe(true);
    }
  });
});
