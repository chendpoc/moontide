import { describe, expect, it } from "vitest";

import { SessionTransform } from "@moontide/session";
import { messagesFromItems } from "@moontide/session";
import { itemsFromMessages } from "@moontide/session";
import type { SessionItem } from "@moontide/session";

function base(over: Partial<SessionItem> & Pick<SessionItem, "kind">): SessionItem {
  return {
    id: "e1",
    sessionId: "sess-1",
    turn: 1,
    at: "2026-07-31T08:00:00.000Z",
    ...over,
  } as SessionItem;
}

describe("SessionTransform", () => {
  it("fromItems toMessages replays conversation", () => {
    const items: SessionItem[] = [
      base({ kind: "user_message", text: "hi" }),
      base({
        kind: "assistant_message",
        blocks: [{ type: "text", text: "hello" }],
      }),
    ];

    const transform = SessionTransform.fromItems(items);
    expect(transform.toMessages()).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: [{ type: "text", text: "hello" }] },
    ]);
  });

  it("toMessageParams mirrors toMessages for adapter boundary", () => {
    const items: SessionItem[] = [base({ kind: "user_message", text: "ping" })];
    const params = SessionTransform.fromItems(items).toMessageParams();
    expect(params).toEqual([{ role: "user", content: "ping" }]);
  });

  it("fromSession reads in-memory context", async () => {
    const { setWorkdir } = await import("../packages/agent/src/config.js");
    const { Session } = await import("@moontide/session");
    const { createTmpWorkdir, removeTmpWorkdir } = await import("./helpers/tmp-workdir.js");

    const tmpDir = createTmpWorkdir("moontide-session-transform-");
    setWorkdir(tmpDir);
    try {
      const session = Session.create(tmpDir);
      await session.appendUser(1, "from session");

      const transform = SessionTransform.fromSession(session);
      expect(transform.toMessages()).toEqual([{ role: "user", content: "from session" }]);
    } finally {
      removeTmpWorkdir(tmpDir);
    }
  });

  it("items → context → items round-trip preserves conversation shape", () => {
    const items: SessionItem[] = [
      base({ kind: "user_message", text: "hi" }),
      base({
        id: "e2",
        kind: "assistant_message",
        blocks: [
          { type: "text", text: "hello" },
          { type: "tool_use", id: "toolu_1", name: "read", input: { path: "a.txt" } },
        ],
      }),
      {
        ...base({ id: "e3", kind: "tool_invocation", turn: 1 }),
        toolUseId: "toolu_1",
        name: "read",
        input: { path: "a.txt" },
      },
      base({
        id: "e4",
        kind: "tool_outcome",
        turn: 1,
        toolUseId: "toolu_1",
        resultSummary: { summary: "ok", byteCount: 2 },
      }),
    ];

    const roundTripped = itemsFromMessages(messagesFromItems(items));
    expect(roundTripped.map((item) => item.kind)).toEqual([
      "user_message",
      "assistant_message",
      "tool_invocation",
      "tool_outcome",
    ]);
    expect(SessionTransform.fromItems(roundTripped).toMessages()).toEqual(
      SessionTransform.fromItems(items).toMessages(),
    );
  });
});
