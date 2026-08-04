import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSessionCommitPort } from "../src/agent/session-commit-port.js";
import { setWorkdir } from "../src/config.js";
import { FileSessionItemReader } from "../src/session/io/index.js";
import { sessionLogPath } from "../src/session/paths.js";
import { Session } from "../src/session/session.js";
import { clearTestRuntime, installTestRuntime } from "./helpers/test-runtime.js";
import { createTmpWorkdir, removeTmpWorkdir } from "./helpers/tmp-workdir.js";

let tmpDir = "";
let testRuntime: ReturnType<typeof installTestRuntime>;

beforeEach(() => {
  tmpDir = createTmpWorkdir("ocula-session-log-");
  setWorkdir(tmpDir);
  testRuntime = installTestRuntime(tmpDir);
});

afterEach(() => {
  clearTestRuntime();
  removeTmpWorkdir(tmpDir);
});

describe("session item I/O", () => {
  it("appends and reads NDJSON entries", async () => {
    const sessionId = "20260730-120000-test0001";
    const commitPort = createSessionCommitPort(tmpDir, testRuntime);
    const session = new Session(
      sessionId,
      new FileSessionItemReader(tmpDir),
      undefined,
      commitPort,
    );

    await session.appendUser(1, "hello");
    await session.appendAssistant(1, [{ type: "text", text: "world" }]);

    const filePath = sessionLogPath(tmpDir, sessionId);
    expect(fs.existsSync(filePath)).toBe(true);

    const entries = await session.readItems();
    expect(entries).toHaveLength(2);
    expect(entries[0]?.kind).toBe("user_message");
    expect(entries[1]?.kind).toBe("assistant_message");
  });

  it("readTail respects afterItemId", async () => {
    const sessionId = "20260730-120000-test0002";
    const reader = new FileSessionItemReader(tmpDir);
    const commitPort = createSessionCommitPort(tmpDir, testRuntime);
    const session = new Session(sessionId, reader, undefined, commitPort);

    await session.appendUser(1, "one");
    await session.appendUser(2, "two");

    const all = await session.readItems();
    const tail = await reader.readTail({
      sessionId,
      afterItemId: all[0]!.id,
    });
    expect(tail).toHaveLength(1);
    expect(tail[0]?.kind).toBe("user_message");
    if (tail[0]?.kind === "user_message") {
      expect(tail[0].text).toBe("two");
    }
  });
});
