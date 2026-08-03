import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setWorkdir } from "../src/config.js";
import { Session } from "../src/session/session.js";
import { sessionLogPath } from "../src/session/paths.js";
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

  it("appendToolInvocation and appendToolOutcome", async () => {
    const session = Session.create(tmpDir);

    await session.appendToolInvocation(2, "toolu_1", "read_file", { path: "a.txt" });
    await session.appendToolOutcome(2, "toolu_1", {
      summary: "file content",
      byteCount: 12,
    });

    const log = await session.readLog();
    expect(log).toHaveLength(2);
    expect(log[0]?.kind).toBe("tool_invocation");
    expect(log[1]?.kind).toBe("tool_outcome");
  });

  it("Session.open continues an existing log", async () => {
    const first = Session.create(tmpDir);
    await first.appendUser(1, "one");

    const second = Session.open(first.sessionId, tmpDir);
    await second.appendUser(2, "two");

    const log = await second.readLog();
    expect(log).toHaveLength(2);
    if (log[1]?.kind === "user_message") {
      expect(log[1].text).toBe("two");
    }
  });
});
