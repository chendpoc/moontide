import type { ContentBlock, LLMRequest, Message, ToolSchema } from "../protocol/types.js";
import { resolveToolChoice } from "../protocol/types.js";
import { applyThinkingLevel } from "./thinking-request.js";
import { toOpenAiToolChoice } from "./tool-choice.js";

export type OpenAiChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      reasoning_content?: string;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    }
  | { role: "tool"; tool_call_id: string; content: string };

function _blocks(content: Message["content"]): ContentBlock[] {
  if (typeof content === "string") {
    return content.length > 0 ? [{ type: "text", text: content }] : [];
  }
  return content;
}

function _toolResultText(content: string | ContentBlock[]): string {
  if (typeof content === "string") {
    return content;
  }
  return JSON.stringify(content);
}

/** Build OpenAI Chat Completions request messages from MoonTide LLMRequest. */
export function toOpenAiChatMessages(request: LLMRequest): OpenAiChatMessage[] {
  const messages: OpenAiChatMessage[] = [];
  if (request.system.trim().length > 0) {
    messages.push({ role: "system", content: request.system });
  }

  for (const message of request.messages) {
    const blocks = _blocks(message.content);

    if (message.role === "user") {
      const text = blocks
        .filter((block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      if (text.length > 0) {
        messages.push({ role: "user", content: text });
      }
      for (const block of blocks) {
        if (block.type === "tool_result") {
          messages.push({
            role: "tool",
            tool_call_id: block.tool_use_id,
            content: _toolResultText(block.content),
          });
        }
      }
      continue;
    }

    const text = blocks
      .filter((block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    const thinking = blocks
      .filter((block): block is Extract<ContentBlock, { type: "thinking" }> => block.type === "thinking")
      .map((block) => block.thinking)
      .join("\n");
    const toolUses = blocks.filter(
      (block): block is Extract<ContentBlock, { type: "tool_use" }> => block.type === "tool_use",
    );

    if (toolUses.length > 0 || thinking.length > 0 || text.length > 0) {
      const assistant: OpenAiChatMessage & { role: "assistant" } = {
        role: "assistant",
        content: text.length > 0 ? text : null,
      };
      if (thinking.length > 0) {
        assistant.reasoning_content = thinking;
      }
      if (toolUses.length > 0) {
        assistant.tool_calls = toolUses.map((block) => ({
          id: block.id,
          type: "function" as const,
          function: {
            name: block.name,
            arguments:
              block.argumentStatus === "malformed_tool_arguments" && block.rawArguments !== undefined
                ? block.rawArguments
                : JSON.stringify(block.input),
          },
        }));
      }
      messages.push(assistant);
    }
  }

  return messages;
}

export function toOpenAiTools(tools: ToolSchema[]): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));
}

export function buildOpenAiChatRequestBody(request: LLMRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    messages: toOpenAiChatMessages(request),
    max_tokens: request.maxTokens,
  };

  if (request.tools.length > 0) {
    body.tools = toOpenAiTools(request.tools);
    const toolChoice = toOpenAiToolChoice(resolveToolChoice(request));
    if (toolChoice !== undefined) {
      body.tool_choice = toolChoice;
    }
  }

  if (request.responseFormat === "json_object") {
    body.response_format = { type: "json_object" };
  }

  applyThinkingLevel(body, request.thinkingLevel);

  return body;
}
