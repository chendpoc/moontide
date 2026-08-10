import { infraError } from "@moontide/shared/errors/factories.js";

import type { ContentBlock } from "../protocol/types.js";
import { parseToolCallArguments } from "./parse-tool-arguments.js";

export interface OpenAiAssistantMessage {
  content?: string | null;
  reasoning_content?: string | null;
  tool_calls?: Array<{
    id: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }> | null;
}

/** Map OpenAI assistant message payload to MoonTide content blocks. */
export function fromOpenAiAssistantMessage(message: OpenAiAssistantMessage | undefined): ContentBlock[] {
  if (!message) {
    throw infraError("LLM response missing assistant message", {
      context: { reason: "llm_malformed_response" },
    });
  }

  const blocks: ContentBlock[] = [];
  const reasoning = message.reasoning_content?.trim();
  if (reasoning && reasoning.length > 0) {
    blocks.push({ type: "thinking", thinking: reasoning });
  }

  const text = message.content?.trim();
  if (text && text.length > 0) {
    blocks.push({ type: "text", text });
  }

  for (const call of message.tool_calls ?? []) {
    const id = call.id;
    const name = call.function?.name;
    const args = call.function?.arguments ?? "";
    if (!id || !name) {
      throw infraError("LLM response tool_call missing id or name", {
        context: { reason: "llm_malformed_response" },
      });
    }
    blocks.push(parseToolCallArguments(id, name, args));
  }

  return blocks;
}
