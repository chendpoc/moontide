import type { Message, ToolSchema } from "../llm/protocol/types.js";

import { modelId } from "../config.js";
import { internalError } from "../errors/factories.js";
import { getLLMProvider } from "../llm/provider.js";
import {
  blockMessageLabel,
  blockMessageLineDetail,
  blockMessagePreview,
  estimateBlockTokens,
  estimateJsonTokens,
  estimateTextTokens,
  type GenericBlock,
} from "../session/block-registry.js";
import type {
  ContextSnapshot,
  ContextStructure,
  MessageLine,
  TokenBreakdown,
} from "./types.js";

function getMessageBlocks(message: Message): GenericBlock[] {
  if (typeof message.content === "string") {
    return [{ type: "text", text: message.content }];
  }
  return message.content as GenericBlock[];
}

export { estimateTextTokens, estimateJsonTokens } from "../session/block-registry.js";

export function estimateBreakdown(snapshot: ContextSnapshot): TokenBreakdown {
  const breakdown: TokenBreakdown = {
    system: estimateTextTokens(snapshot.system),
    toolDefinitions: estimateJsonTokens(snapshot.tools),
    user: 0,
    assistant: 0,
    thinking: 0,
    toolResults: 0,
    total: 0,
  };

  for (const message of snapshot.messages) {
    if (typeof message.content === "string") {
      const tokens = estimateTextTokens(message.content);
      if (message.role === "user") {
        breakdown.user += tokens;
      } else {
        breakdown.assistant += tokens;
      }
      continue;
    }

    for (const block of getMessageBlocks(message)) {
      const part = estimateBlockTokens(block);
      if (message.role === "user") {
        breakdown.toolResults += part.toolResults;
      } else {
        breakdown.assistant += part.assistant;
        breakdown.thinking += part.thinking;
      }
    }
  }

  breakdown.total =
    breakdown.system +
    breakdown.toolDefinitions +
    breakdown.user +
    breakdown.assistant +
    breakdown.thinking +
    breakdown.toolResults;

  return breakdown;
}

export function analyzeStructure(snapshot: ContextSnapshot): ContextStructure {
  let toolCallCount = 0;
  let maxToolResultChars = 0;

  for (const message of snapshot.messages) {
    for (const block of getMessageBlocks(message)) {
      const part = estimateBlockTokens(block);
      toolCallCount += part.toolCalls;
      maxToolResultChars = Math.max(maxToolResultChars, part.maxToolResultChars);
    }
  }

  return {
    messageCount: snapshot.messages.length,
    toolCallCount,
    maxToolResultChars,
  };
}

export function buildMessageLines(snapshot: ContextSnapshot): MessageLine[] {
  return snapshot.messages.map((message, index) => {
    if (typeof message.content === "string") {
      const tokens = estimateTextTokens(message.content);
      return {
        index,
        role: message.role,
        tokens,
        label: message.role,
        preview: blockMessagePreview({ type: "text", text: message.content }, {
          user: 0,
          assistant: tokens,
          thinking: 0,
          toolResults: 0,
          toolCalls: 0,
          maxToolResultChars: 0,
        }),
      };
    }

    let tokens = 0;
    const labels: string[] = [];
    let preview = "";
    const details: MessageLine["details"] = [];

    for (const block of getMessageBlocks(message)) {
      const part = estimateBlockTokens(block);
      tokens += part.user + part.assistant + part.thinking + part.toolResults;
      labels.push(blockMessageLabel(block, part));
      preview ||= blockMessagePreview(block, part);
      const detail = blockMessageLineDetail(block, part);
      if (detail) {
        details.push(detail);
      }
    }

    return {
      index,
      role: message.role,
      tokens,
      label: labels.join(" + ") || message.role,
      preview: preview || message.role,
      details: details.length > 0 ? details : undefined,
    };
  });
}

export async function exactTokenCount(
  messages: Message[],
  system: string,
  tools: ToolSchema[],
): Promise<number> {
  const provider = getLLMProvider();
  if (!provider.countTokens) {
    throw internalError("LLM provider does not support countTokens");
  }
  return provider.countTokens({
    model: modelId(),
    system,
    messages,
    tools,
    maxTokens: 1,
  });
}
