import { describe, expect, it } from "vitest";

import { fromOpenAiAssistantMessage } from "../packages/llm/src/normalize/from-openai-assistant.js";
import { parseToolCallArguments } from "../packages/llm/src/normalize/parse-tool-arguments.js";
import { toOpenAiToolChoice } from "../packages/llm/src/normalize/tool-choice.js";
import {
  buildOpenAiChatRequestBody,
  toOpenAiChatMessages,
} from "../packages/llm/src/normalize/to-openai-chat-messages.js";
import {
  buildOpenAiResponsesRequestBody,
  toResponsesInputItems,
} from "../packages/llm/src/normalize/to-openai-responses-body.js";
import { fromOpenAiResponsesOutput } from "../packages/llm/src/normalize/from-openai-responses.js";
import { toResponsesToolChoice } from "../packages/llm/src/normalize/to-responses-tool-choice.js";
import { toAnthropicCountTokensBody } from "../packages/llm/src/normalize/to-anthropic-count-tokens-body.js";

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

  it("toResponsesInputItems maps thinking, tool_use replay, and tool results", () => {
    const items = toResponsesInputItems({
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

    expect(items).toEqual([
      {
        type: "reasoning",
        content: [{ type: "reasoning_text", text: "plan" }],
      },
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "call tool" }],
      },
      {
        type: "function_call",
        call_id: "call_1",
        name: "grep",
        arguments: "{\"pattern\":\"foo\"}",
      },
      { type: "function_call_output", call_id: "call_1", output: "match" },
    ]);
  });

  it("buildOpenAiResponsesRequestBody maps instructions, max_output_tokens, and tool_choice", () => {
    const body = buildOpenAiResponsesRequestBody({
      model: "deepseek-v4-flash",
      system: "sys",
      maxTokens: 50,
      thinkingLevel: "medium",
      toolChoice: { mode: "specified", name: "grep" },
      tools: [{ name: "grep", description: "search", input_schema: { type: "object" } }],
      messages: [{ role: "user", content: "hi" }],
      responseFormat: "json_object",
    });

    expect(body.instructions).toBe("sys");
    expect(body.input).toBe("hi");
    expect(body.max_output_tokens).toBe(50);
    expect(body.tool_choice).toEqual({ type: "function", name: "grep" });
    expect(body.reasoning).toEqual({ effort: "medium" });
    expect(body.text).toEqual({ format: { type: "json_object" } });
  });

  it("toResponsesToolChoice maps specified tool without nested function object", () => {
    expect(toResponsesToolChoice({ mode: "specified", name: "grep" })).toEqual({
      type: "function",
      name: "grep",
    });
  });

  it("fromOpenAiResponsesOutput preserves output item order", () => {
    const blocks = fromOpenAiResponsesOutput([
      {
        type: "reasoning",
        content: [{ type: "reasoning_text", text: "why" }],
      },
      {
        type: "message",
        content: [{ type: "output_text", text: "done" }],
      },
      {
        type: "function_call",
        call_id: "a",
        name: "grep",
        arguments: "not-json",
      },
    ]);

    expect(blocks[0]).toEqual({ type: "thinking", thinking: "why" });
    expect(blocks[1]).toEqual({ type: "text", text: "done" });
    expect(blocks[2]).toMatchObject({
      type: "tool_use",
      id: "a",
      argumentStatus: "malformed_tool_arguments",
    });
  });

  it("toAnthropicCountTokensBody maps system, tools, and assistant thinking", () => {
    expect(
      toAnthropicCountTokensBody({
        model: "deepseek-v4-pro",
        system: "sys",
        maxTokens: 1,
        tools: [{ name: "grep", description: "search", input_schema: { type: "object" } }],
        messages: [
          { role: "user", content: "hello" },
          {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "plan" },
              { type: "text", text: "ok" },
            ],
          },
        ],
      }),
    ).toEqual({
      model: "deepseek-v4-pro",
      system: "sys",
      tools: [
        {
          name: "grep",
          description: "search",
          input_schema: { type: "object" },
        },
      ],
      messages: [
        { role: "user", content: "hello" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "plan" },
            { type: "text", text: "ok" },
          ],
        },
      ],
    });
  });
});
