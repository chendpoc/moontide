import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setWorkdir } from "../src/config.js";
import { Session } from "../src/session/session.js";
import { sessionLogPath } from "../src/session/paths.js";
import type { SessionMessage } from "../src/session/types.js";
import { createTmpWorkdir, removeTmpWorkdir } from "./helpers/tmp-workdir.js";

let tmpDir = "";

beforeEach(() => {
  tmpDir = createTmpWorkdir("ocula-session-");
  setWorkdir(tmpDir);
});

afterEach(() => {
  removeTmpWorkdir(tmpDir);
});

describe("Session", () => {
  it("appendUser and appendAssistant roundtrip via readLog", async () => {
    const session = Session.create(tmpDir);

    await session.appendUser(1, "hello");
    await session.appendAssistant(1, [{ type: "text", text: "world" }]);

    const log = await session.readLog();
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ kind: "user_message", text: "hello", turn: 1 });
    expect(log[1]).toMatchObject({ kind: "assistant_message", turn: 1 });
    expect(fs.existsSync(sessionLogPath(tmpDir, session.sessionId))).toBe(true);
  });

  it("appendToolInvocation and appendToolOutcome persist items", async () => {
    const session = Session.create(tmpDir);

    await session.appendToolInvocation(2, "toolu_1", "read_file", { path: "a.txt" });
    await session.appendToolOutcome(2, "toolu_1", {
      summary: "file content",
      byteCount: 12,
    });

    const log = await session.readItems();
    expect(log.length).toBeGreaterThanOrEqual(2);
    expect(log.some((item) => item.kind === "tool_invocation")).toBe(true);
    expect(log.some((item) => item.kind === "tool_outcome")).toBe(true);
  });

  it("Session.open hydrates context for toMessages", async () => {
    const first = Session.create(tmpDir);
    await first.appendUser(1, "one");

    const second = Session.open(first.sessionId, tmpDir);
    expect(second.toMessages()).toEqual([{ role: "user", content: "one" }]);
  });

  it("importItems replace rewrites file and syncs context", async () => {
    const session = Session.create(tmpDir);
    await session.appendUser(1, "old");

    const items = await session.readItems();
    const replacement = items.map((item) =>
      item.kind === "user_message" ? { ...item, text: "new" } : item,
    );

    await session.importItems(replacement, { mode: "replace" });

    expect(session.toMessages()).toEqual([{ role: "user", content: "new" }]);
    const onDisk = await session.readItems();
    expect(onDisk).toHaveLength(1);
    if (onDisk[0]?.kind === "user_message") {
      expect(onDisk[0].text).toBe("new");
    }
  });

  it("importItems append-new syncs context with disk", async () => {
    const session = Session.create(tmpDir);
    await session.appendUser(1, "first");

    const extra = [
      {
        kind: "user_message" as const,
        id: "e-import",
        sessionId: session.sessionId,
        turn: 2,
        at: "2026-07-31T08:00:00.000Z",
        text: "imported",
      },
    ];

    await session.importItems(extra, { mode: "append-new" });

    expect(session.toMessages()).toEqual([
      { role: "user", content: "first" },
      { role: "user", content: "imported" },
    ]);
    expect(await session.readItems()).toHaveLength(2);
  });

  it("getContext returns a detached readonly view", async () => {
    const session = Session.create(tmpDir);
    await session.appendUser(1, "hello");

    const view = session.getContext().messages;
    expect(view).toHaveLength(1);
    expect(session.getMessages()).toHaveLength(1);

    // Shallow copy: mutating the returned array must not affect Session.
    (view as SessionMessage[]).push({
      id: "evil",
      sessionId: session.sessionId,
      turn: 99,
      at: new Date().toISOString(),
      role: "user",
      content: "injected",
    });
    expect(session.getMessages()).toHaveLength(1);
    expect(session.toMessages()).toEqual([{ role: "user", content: "hello" }]);
  });

  it("appendAssistant with tool_use roundtrips via toMessages", async () => {
    const session = Session.create(tmpDir);
    await session.appendUser(1, "run tool");
    await session.appendAssistant(1, [
      { type: "text", text: "calling" },
      { type: "tool_use", id: "toolu_1", name: "grep", input: { pattern: "foo" } },
    ]);
    await session.appendToolResult(1, "toolu_1", "matches: 3");

    const messages = session.toMessages();
    expect(messages).toEqual([
      { role: "user", content: "run tool" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "calling" },
          { type: "tool_use", id: "toolu_1", name: "grep", input: { pattern: "foo" } },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "matches: 3" }],
      },
    ]);
  });
});
