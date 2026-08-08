import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSessionCommitPort } from "../apps/moontide/src/agent/session-commit-port.js";
import { setWorkdir } from "../apps/moontide/src/config.js";
import { Session } from "@moontide/session";
import { sessionLogPath } from "@moontide/session";
import type { SessionMessage } from "@moontide/session";
import { clearTestRuntime, installTestRuntime } from "./helpers/test-runtime.js";
import { createTmpWorkdir, removeTmpWorkdir } from "./helpers/tmp-workdir.js";

let tmpDir = "";
let testRuntime: ReturnType<typeof installTestRuntime>;

beforeEach(() => {
  tmpDir = createTmpWorkdir("moontide-session-");
  setWorkdir(tmpDir);
  testRuntime = installTestRuntime(tmpDir);
});

afterEach(() => {
  clearTestRuntime();
  removeTmpWorkdir(tmpDir);
});

describe("Session", () => {
  function session(workdir = tmpDir) {
    return Session.create(workdir, createSessionCommitPort(workdir, testRuntime));
  }

  it("appendUser and appendAssistant roundtrip via readItems", async () => {
    const s = session();

    await s.appendUser(1, "hello");
    await s.appendAssistant(1, [{ type: "text", text: "world" }]);

    const log = await s.readItems();
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ kind: "user_message", text: "hello", turn: 1 });
    expect(log[1]).toMatchObject({ kind: "assistant_message", turn: 1 });
    expect(fs.existsSync(sessionLogPath(tmpDir, s.sessionId))).toBe(true);
  });

  it("appendToolInvocation and appendToolOutcome persist items", async () => {
    const s = session();

    await s.appendToolInvocation(2, "toolu_1", "read_file", { path: "a.txt" });
    await s.appendToolOutcome(2, "toolu_1", {
      summary: "file content",
      byteCount: 12,
    });

    const log = await s.readItems();
    expect(log.length).toBeGreaterThanOrEqual(2);
    expect(log.some((item) => item.kind === "tool_invocation")).toBe(true);
    expect(log.some((item) => item.kind === "tool_outcome")).toBe(true);
  });

  it("Session.open hydrates context for toMessages", async () => {
    const first = session();
    await first.appendUser(1, "one");

    const port = createSessionCommitPort(tmpDir, testRuntime);
    const second = Session.open(first.sessionId, tmpDir, port);
    expect(second.toMessages()).toEqual([{ role: "user", content: "one" }]);
  });

  it("importItems replace rewrites file and syncs context", async () => {
    const s = session();
    await s.appendUser(1, "old");

    const items = await s.readItems();
    const replacement = items.map((item) =>
      item.kind === "user_message" ? { ...item, text: "new" } : item,
    );

    await s.importItems(replacement, { mode: "replace" });

    expect(s.toMessages()).toEqual([{ role: "user", content: "new" }]);
    const onDisk = await s.readItems();
    expect(onDisk).toHaveLength(1);
    if (onDisk[0]?.kind === "user_message") {
      expect(onDisk[0].text).toBe("new");
    }
  });

  it("importItems append-new syncs context with disk", async () => {
    const s = session();
    await s.appendUser(1, "first");

    const extra = [
      {
        kind: "user_message" as const,
        id: "e-import",
        sessionId: s.sessionId,
        turn: 2,
        at: "2026-07-31T08:00:00.000Z",
        text: "imported",
      },
    ];

    await s.importItems(extra, { mode: "append-new" });

    expect(s.toMessages()).toEqual([
      { role: "user", content: "first" },
      { role: "user", content: "imported" },
    ]);
    expect(await s.readItems()).toHaveLength(2);
  });

  it("getContext returns a detached readonly view", async () => {
    const s = session();
    await s.appendUser(1, "hello");

    const view = s.getContext().messages;
    expect(view).toHaveLength(1);
    expect(s.getMessages()).toHaveLength(1);

    // Shallow copy: mutating the returned array must not affect Session.
    (view as SessionMessage[]).push({
      id: "evil",
      sessionId: s.sessionId,
      turn: 99,
      at: new Date().toISOString(),
      role: "user",
      content: "injected",
    });
    expect(s.getMessages()).toHaveLength(1);
    expect(s.toMessages()).toEqual([{ role: "user", content: "hello" }]);
  });

  it("appendAssistant with tool_use roundtrips via toMessages", async () => {
    const s = session();
    await s.appendUser(1, "run tool");
    await s.appendAssistant(1, [
      { type: "text", text: "calling" },
      { type: "tool_use", id: "toolu_1", name: "grep", input: { pattern: "foo" } },
    ]);
    await s.appendToolOutcome(1, "toolu_1", {
      summary: "matches: 3",
      byteCount: Buffer.byteLength("matches: 3", "utf8"),
    });

    const messages = s.toMessages();
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
