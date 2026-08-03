import { describe, expect, it } from "vitest";

import { SessionLogSlice } from "../src/session/log-slice.js";
import type { SessionLog } from "../src/session/log-types.js";

function base(over: Partial<SessionLog> & Pick<SessionLog, "kind">): SessionLog {
  return {
    id: "e1",
    sessionId: "sess-1",
    turn: 1,
    at: "2026-07-31T08:00:00.000Z",
    ...over,
  } as SessionLog;
}

describe("SessionLogSlice", () => {
  it("fromLog toMessages replays conversation", () => {
    const log: SessionLog[] = [
      base({ kind: "user_message", text: "hi" }),
      base({
        kind: "assistant_message",
        blocks: [{ type: "text", text: "hello" }],
      }),
    ];

    const slice = SessionLogSlice.fromLog(log);
    expect(slice.toMessages()).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: [{ type: "text", text: "hello" }] },
    ]);
  });

  it("toMessageParams casts messages for SDK boundary", () => {
    const log: SessionLog[] = [base({ kind: "user_message", text: "ping" })];
    const params = SessionLogSlice.fromLog(log).toMessageParams();
    expect(params).toEqual([{ role: "user", content: "ping" }]);
  });

  it("fromSession reads log from disk", async () => {
    const { setWorkdir } = await import("../src/config.js");
    const { Session } = await import("../src/session/session.js");
    const { createTmpWorkdir, removeTmpWorkdir } = await import("./helpers/tmp-workdir.js");

    const tmpDir = createTmpWorkdir("ocula-log-slice-");
    setWorkdir(tmpDir);
    try {
      const session = Session.create(tmpDir);
      await session.appendUser(1, "from session");

      const slice = await SessionLogSlice.fromSession(session);
      expect(slice.toMessages()).toEqual([{ role: "user", content: "from session" }]);
    } finally {
      removeTmpWorkdir(tmpDir);
    }
  });
});
