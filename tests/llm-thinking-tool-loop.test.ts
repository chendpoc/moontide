import { describe, expect, it } from "vitest";

import {
  assistantMessageToContentBlocks,
  llmResponseToAssistantMessage,
} from "../apps/moontide/src/agent/harness/message-map.js";
import { toOpenAiChatMessages } from "../packages/llm/src/normalize/to-openai-chat-messages.js";
import { messagesFromContext, messagesFromItems } from "@moontide/session";
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

describe("thinking continuity", () => {
  it("round-trips thinking and tool_use through AssistantMessage", () => {
    const blocks = [
      { type: "thinking" as const, thinking: "plan search" },
      {
        type: "tool_use" as const,
        id: "call_1",
        name: "grep",
        input: { pattern: "MoonTide" },
        argumentStatus: "ok" as const,
      },
    ];

    const assistant = llmResponseToAssistantMessage(blocks);
    expect(assistant.content).toEqual([
      { type: "thinking", text: "plan search" },
      {
        type: "toolCall",
        toolCallId: "call_1",
        toolName: "grep",
        args: { pattern: "MoonTide" },
        argumentStatus: "ok",
      },
    ]);

    expect(assistantMessageToContentBlocks(assistant)).toEqual(blocks);
  });

  it("replays session thinking into OpenAI reasoning_content after reload", () => {
    const log: SessionItem[] = [
      base({ id: "e1", kind: "user_message", text: "find MoonTide" }),
      base({
        id: "e2",
        kind: "assistant_message",
        blocks: [
          { type: "thinking", thinking: "need grep" },
          {
            type: "tool_use",
            id: "call_1",
            name: "grep",
            input: { pattern: "MoonTide" },
          },
        ],
      }),
      base({
        id: "e3",
        kind: "tool_outcome",
        toolUseId: "call_1",
        resultSummary: { summary: "hit", byteCount: 3 },
      }),
    ];

    const protocolMessages = messagesFromContext({ messages: messagesFromItems(log) });
    const wireMessages = toOpenAiChatMessages({
      model: "deepseek-v4-flash",
      system: "",
      maxTokens: 128,
      tools: [{ name: "grep", description: "search", input_schema: { type: "object" } }],
      messages: protocolMessages,
    });

    const assistant = wireMessages.find(
      (message): message is Extract<(typeof wireMessages)[number], { role: "assistant" }> =>
        message.role === "assistant",
    );
    expect(assistant?.reasoning_content).toBe("need grep");
    expect(assistant?.tool_calls?.[0]?.id).toBe("call_1");
  });

  it("preserves malformed_tool_arguments on toolCall round-trip", () => {
    const blocks = [
      {
        type: "tool_use" as const,
        id: "call_bad",
        name: "grep",
        input: {},
        argumentStatus: "malformed_tool_arguments" as const,
        rawArguments: "{bad",
      },
    ];
    const assistant = llmResponseToAssistantMessage(blocks);
    expect(assistantMessageToContentBlocks(assistant)).toEqual(blocks);
  });
});
