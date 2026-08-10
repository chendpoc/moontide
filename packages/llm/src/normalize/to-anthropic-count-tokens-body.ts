import type { ContentBlock, LLMRequest, Message, ToolSchema } from "../protocol/types.js";

type AnthropicCountTokensMessage =
  | { role: "user" | "assistant"; content: string | AnthropicContentBlock[] };

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

function _blocks(content: Message["content"]): ContentBlock[] {
  if (typeof content === "string") {
    return content.length > 0 ? [{ type: "text", text: content }] : [];
  }
  return content;
}

function _toAnthropicContentBlocks(blocks: ContentBlock[]): AnthropicContentBlock[] {
  const out: AnthropicContentBlock[] = [];
  for (const block of blocks) {
    if (block.type === "text") {
      out.push({ type: "text", text: block.text });
      continue;
    }
    if (block.type === "thinking") {
      // count_tokens accepts text blocks; thinking is approximated as text for token estimate.
      out.push({ type: "text", text: block.thinking });
      continue;
    }
    if (block.type === "tool_use") {
      out.push({
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: block.input,
      });
      continue;
    }
    if (block.type === "tool_result") {
      out.push({
        type: "tool_result",
        tool_use_id: block.tool_use_id,
        content: typeof block.content === "string" ? block.content : JSON.stringify(block.content),
      });
    }
  }
  return out;
}

function _toAnthropicTools(tools: ToolSchema[]): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema,
  }));
}

/** Build Anthropic Messages count_tokens body from MoonTide LLMRequest. */
export function toAnthropicCountTokensBody(request: LLMRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    messages: [] as AnthropicCountTokensMessage[],
  };

  if (request.system.trim().length > 0) {
    body.system = request.system;
  }

  if (request.tools.length > 0) {
    body.tools = _toAnthropicTools(request.tools);
  }

  const messages: AnthropicCountTokensMessage[] = [];
  for (const message of request.messages) {
    const blocks = _blocks(message.content);
    if (message.role === "user") {
      const text = blocks
        .filter((block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      const structured = _toAnthropicContentBlocks(
        blocks.filter((block) => block.type !== "text"),
      );
      if (structured.length > 0) {
        const content: AnthropicContentBlock[] = [];
        if (text.length > 0) {
          content.push({ type: "text", text });
        }
        content.push(...structured);
        messages.push({ role: "user", content });
      } else if (text.length > 0) {
        messages.push({ role: "user", content: text });
      }
      continue;
    }

    const content = _toAnthropicContentBlocks(blocks);
    if (content.length > 0) {
      messages.push({ role: "assistant", content });
    }
  }

  body.messages = messages;
  return body;
}
