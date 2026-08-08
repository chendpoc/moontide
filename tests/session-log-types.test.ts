import { describe, expect, it } from "vitest";

import { isSessionItem, type SessionItem } from "@moontide/session";

const BASE = {
  id: "entry-1",
  sessionId: "20260731-160000-a1b2c3d4",
  turn: 1,
  at: "2026-07-31T08:00:00.000Z",
};

const FIXTURES: SessionItem[] = [
  { ...BASE, kind: "user_message", text: "hello" },
  {
    ...BASE,
    kind: "assistant_message",
    blocks: [{ type: "text", text: "hi there" }],
  },
  {
    ...BASE,
    kind: "tool_invocation",
    toolUseId: "tu_1",
    name: "read_file",
    input: { path: "README.md" },
  },
  {
    ...BASE,
    kind: "tool_outcome",
    toolUseId: "tu_1",
    resultSummary: { summary: "file contents…", byteCount: 120 },
  },
  {
    ...BASE,
    kind: "compaction",
    compactionKind: "prune",
    excludedLogIds: ["entry-0"],
    beforeTokens: 1000,
    afterTokens: 800,
  },
  {
    ...BASE,
    kind: "checkpoint_created",
    checkpointId: "ckpt-1",
  },
  {
    ...BASE,
    kind: "protocol_reminder",
    reminderKind: "orient",
    text: "[Deep Task — protocol reminder] example",
  },
  {
    ...BASE,
    kind: "routing",
    decision: {
      logicalModelId: "claude-sonnet",
      providerPresetId: "anthropic",
      vendorModelId: "claude-sonnet-4-20250514",
      thinkingLevel: "off",
      mode: "manual",
    },
  },
];

describe("session log types", () => {
  it("parses NDJSON fixtures into SessionItem union", () => {
    for (const fixture of FIXTURES) {
      const line = JSON.stringify(fixture);
      const parsed: unknown = JSON.parse(line);
      expect(isSessionItem(parsed)).toBe(true);
      expect(parsed).toEqual(fixture);
    }
  });

  it("rejects invalid kinds", () => {
    expect(isSessionItem({ ...BASE, kind: "trace" })).toBe(false);
    expect(isSessionItem(null)).toBe(false);
    expect(isSessionItem("user_message")).toBe(false);
  });
});
