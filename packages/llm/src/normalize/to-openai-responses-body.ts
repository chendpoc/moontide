import type { ContentBlock, LLMRequest, Message, ToolSchema } from "../protocol/types.js";
import { resolveToolChoice } from "../protocol/types.js";
import { applyResponsesReasoning } from "./responses-reasoning.js";
import { toResponsesToolChoice } from "./to-responses-tool-choice.js";

export type ResponsesInputItem =
  | { type: "message"; role: "user" | "assistant"; content: string | Array<{ type: "input_text" | "output_text"; text: string }> }
  | { type: "reasoning"; content: Array<{ type: "reasoning_text"; text: string }> }
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: string };

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

function _userTextBlocks(blocks: ContentBlock[]): string {
  return blocks
    .filter((block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function _appendAssistantBlock(items: ResponsesInputItem[], block: ContentBlock): void {
  if (block.type === "thinking" && block.thinking.trim().length > 0) {
    items.push({
      type: "reasoning",
      content: [{ type: "reasoning_text", text: block.thinking }],
    });
    return;
  }

  if (block.type === "text" && block.text.trim().length > 0) {
    items.push({
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: block.text }],
    });
    return;
  }

  if (block.type === "tool_use") {
    items.push({
      type: "function_call",
      call_id: block.id,
      name: block.name,
      arguments:
        block.argumentStatus === "malformed_tool_arguments" && block.rawArguments !== undefined
          ? block.rawArguments
          : JSON.stringify(block.input),
    });
  }
}

/** Build Responses API `input` items from MoonTide messages (system uses `instructions`). */
export function toResponsesInputItems(request: LLMRequest): ResponsesInputItem[] {
  const items: ResponsesInputItem[] = [];

  for (const message of request.messages) {
    const blocks = _blocks(message.content);

    if (message.role === "user") {
      const text = _userTextBlocks(blocks);
      if (text.length > 0) {
        items.push({ type: "message", role: "user", content: text });
      }
      for (const block of blocks) {
        if (block.type === "tool_result") {
          items.push({
            type: "function_call_output",
            call_id: block.tool_use_id,
            output: _toolResultText(block.content),
          });
        }
      }
      continue;
    }

    for (const block of blocks) {
      _appendAssistantBlock(items, block);
    }
  }

  return items;
}

export function toResponsesTools(tools: ToolSchema[]): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema,
  }));
}

/** Build OpenAI Responses API request body from MoonTide LLMRequest. */
export function buildOpenAiResponsesRequestBody(request: LLMRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    max_output_tokens: request.maxTokens,
  };

  if (request.system.trim().length > 0) {
    body.instructions = request.system;
  }

  const inputItems = toResponsesInputItems(request);
  if (inputItems.length === 1 && inputItems[0]?.type === "message" && inputItems[0].role === "user") {
    const only = inputItems[0];
    body.input = typeof only.content === "string" ? only.content : only.content[0]?.text ?? "";
  } else if (inputItems.length > 0) {
    body.input = inputItems;
  }

  if (request.tools.length > 0) {
    body.tools = toResponsesTools(request.tools);
    const toolChoice = toResponsesToolChoice(resolveToolChoice(request));
    if (toolChoice !== undefined) {
      body.tool_choice = toolChoice;
    }
  }

  if (request.responseFormat === "json_object") {
    body.text = { format: { type: "json_object" } };
  }

  applyResponsesReasoning(body, request.thinkingLevel);

  return body;
}
