import { describe, expect, it } from "vitest";

import { logToMessages } from "../src/context/composer/messages/log-to-messages.js";
import type { SessionItem } from "../src/session/types.js";

function base(over: Partial<SessionItem> & Pick<SessionItem, "kind">): SessionItem {
  return {
    id: "e1",
    sessionId: "sess-1",
    turn: 1,
    at: "2026-07-31T08:00:00.000Z",
    ...over,
  } as SessionItem;
}

describe("logToMessages", () => {
  it("replays user then assistant text", () => {
    const log: SessionItem[] = [
      base({ id: "e1", kind: "user_message", text: "hi" }),
      base({
        id: "e2",
        kind: "assistant_message",
        blocks: [{ type: "text", text: "hello" }],
      }),
    ];

    expect(logToMessages(log)).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: [{ type: "text", text: "hello" }] },
    ]);
  });

  it("merges tool_outcome into a user message with tool_result blocks", () => {
    const log: SessionItem[] = [
      base({ id: "e1", kind: "user_message", text: "read file" }),
      base({
        id: "e2",
        kind: "assistant_message",
        blocks: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "read_file",
            input: { path: "a.txt" },
          },
        ],
      }),
      base({
        id: "e3",
        kind: "tool_outcome",
        toolUseId: "toolu_1",
        resultSummary: { summary: "contents", byteCount: 8 },
      }),
      base({
        id: "e4",
        kind: "assistant_message",
        blocks: [{ type: "text", text: "done" }],
      }),
    ];

    expect(logToMessages(log)).toEqual([
      { role: "user", content: "read file" },
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "read_file",
            input: { path: "a.txt" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_1",
            content: "contents",
          },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "done" }] },
    ]);
  });

  it("ignores tool_invocation when assistant already has tool_use", () => {
    const log: SessionItem[] = [
      base({
        id: "e2",
        kind: "assistant_message",
        blocks: [
          { type: "tool_use", id: "toolu_1", name: "bash", input: { command: "echo" } },
        ],
      }),
      base({
        id: "e3",
        kind: "tool_invocation",
        toolUseId: "toolu_1",
        name: "bash",
        input: { command: "echo" },
      }),
      base({
        id: "e4",
        kind: "tool_outcome",
        toolUseId: "toolu_1",
        resultSummary: { summary: "ok", byteCount: 2 },
      }),
    ];

    const messages = logToMessages(log);
    expect(messages).toHaveLength(2);
    expect(messages[1]?.role).toBe("user");
  });

  it("respects upToTurn", () => {
    const log: SessionItem[] = [
      base({ id: "e1", kind: "user_message", text: "turn1", turn: 1 }),
      base({ id: "e2", kind: "user_message", text: "turn2", turn: 2 }),
    ];

    expect(logToMessages(log, { upToTurn: 1 })).toEqual([
      { role: "user", content: "turn1" },
    ]);
  });

  it("combines multiple tool outcomes into one user message", () => {
    const log: SessionItem[] = [
      base({
        id: "e2",
        kind: "assistant_message",
        blocks: [
          { type: "tool_use", id: "a", name: "t1", input: {} },
          { type: "tool_use", id: "b", name: "t2", input: {} },
        ],
      }),
      base({
        id: "e3",
        kind: "tool_outcome",
        toolUseId: "a",
        resultSummary: { summary: "r1", byteCount: 2 },
      }),
      base({
        id: "e4",
        kind: "tool_outcome",
        toolUseId: "b",
        resultSummary: { summary: "r2", byteCount: 2 },
      }),
    ];

    const messages = logToMessages(log);
    expect(messages).toHaveLength(2);
    expect(messages[1]).toEqual({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "a", content: "r1" },
        { type: "tool_result", tool_use_id: "b", content: "r2" },
      ],
    });
  });
});
