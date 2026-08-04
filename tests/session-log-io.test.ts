import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setWorkdir } from "../src/config.js";
import { FileSessionItemReader, FileSessionItemWriter } from "../src/session/io/index.js";
import { Session } from "../src/session/session.js";
import { sessionLogPath } from "../src/session/paths.js";
import { createTmpWorkdir, removeTmpWorkdir } from "./helpers/tmp-workdir.js";

let tmpDir = "";

beforeEach(() => {
  tmpDir = createTmpWorkdir("ocula-session-log-");
  setWorkdir(tmpDir);
});

afterEach(() => {
  removeTmpWorkdir(tmpDir);
});

describe("session item I/O", () => {
  it("appends and reads NDJSON entries", async () => {
    const sessionId = "20260730-120000-test0001";
    const session = new Session(
      sessionId,
      new FileSessionItemWriter(tmpDir),
      new FileSessionItemReader(tmpDir),
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
    const session = new Session(
      sessionId,
      new FileSessionItemWriter(tmpDir),
      reader,
    );

    await session.appendUser(1, "one");
    await session.appendUser(2, "two");

    const all = await session.readItems();
    const tail = await reader.readTail({
      sessionId,
      afterLogId: all[0]!.id,
    });
    expect(tail).toHaveLength(1);
    expect(tail[0]?.kind).toBe("user_message");
    if (tail[0]?.kind === "user_message") {
      expect(tail[0].text).toBe("two");
    }
  });
});
