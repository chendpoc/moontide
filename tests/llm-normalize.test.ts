import { describe, expect, it } from "vitest";

import { fromOpenAiAssistantMessage } from "../packages/llm/src/normalize/from-openai-assistant.js";
import { parseToolCallArguments } from "../packages/llm/src/normalize/parse-tool-arguments.js";
import { toOpenAiToolChoice } from "../packages/llm/src/normalize/tool-choice.js";
import {
  buildOpenAiChatRequestBody,
  toOpenAiChatMessages,
} from "../packages/llm/src/normalize/to-openai-chat-messages.js";

describe("llm normalize", () => {
  it("toOpenAiChatMessages maps thinking and tool_use for assistant replay", () => {
    const messages = toOpenAiChatMessages({
      model: "deepseek-v4-flash",
      system: "sys",
      maxTokens: 100,
      tools: [],
      messages: [
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "plan" },
            { type: "text", text: "call tool" },
            { type: "tool_use", id: "call_1", name: "grep", input: { pattern: "foo" } },
          ],
        },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "call_1", content: "match" }],
        },
      ],
    });

    expect(messages).toEqual([
      { role: "system", content: "sys" },
      {
        role: "assistant",
        content: "call tool",
        reasoning_content: "plan",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "grep", arguments: "{\"pattern\":\"foo\"}" },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: "match" },
    ]);
  });

  it("buildOpenAiChatRequestBody maps tool_choice and thinking", () => {
    const body = buildOpenAiChatRequestBody({
      model: "deepseek-v4-flash",
      system: "",
      maxTokens: 50,
      thinkingLevel: "medium",
      toolChoice: { mode: "none" },
      tools: [{ name: "grep", description: "search", input_schema: { type: "object" } }],
      messages: [{ role: "user", content: "hi" }],
    });

    expect(body.tool_choice).toBe("none");
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.reasoning_effort).toBe("medium");
  });

  it("toOpenAiToolChoice maps specified tool", () => {
    expect(toOpenAiToolChoice({ mode: "specified", name: "grep" })).toEqual({
      type: "function",
      function: { name: "grep" },
    });
  });

  it("parseToolCallArguments marks malformed JSON", () => {
    const block = parseToolCallArguments("call_1", "grep", "{not-json");
    expect(block.argumentStatus).toBe("malformed_tool_arguments");
    expect(block.input).toEqual({});
    expect(block.rawArguments).toBe("{not-json");
  });

  it("fromOpenAiAssistantMessage preserves tool call order", () => {
    const blocks = fromOpenAiAssistantMessage({
      reasoning_content: "why",
      content: "done",
      tool_calls: [
        { id: "a", function: { name: "grep", arguments: "{\"pattern\":\"x\"}" } },
        { id: "b", function: { name: "read", arguments: "not-json" } },
      ],
    });

    expect(blocks[0]).toEqual({ type: "thinking", thinking: "why" });
    expect(blocks[1]).toEqual({ type: "text", text: "done" });
    expect(blocks[2]).toMatchObject({ type: "tool_use", id: "a", name: "grep" });
    expect(blocks[3]).toMatchObject({
      type: "tool_use",
      id: "b",
      argumentStatus: "malformed_tool_arguments",
    });
  });
});
