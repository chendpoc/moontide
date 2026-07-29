import type { MessageParam, Tool } from "@anthropic-ai/sdk/resources/messages/messages.js";

import { countTokens } from "../llm.js";
import type { ContextSnapshot, ContextStructure, MessageLine, TokenBreakdown } from "./types.js";

const PREVIEW_LIMIT = 48;

type GenericBlock = {
  type?: string;
  text?: string;
  thinking?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
};

export function estimateTextTokens(text: string): number {
  if (!text) {
    return 0;
  }
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateJsonTokens(value: unknown): number {
  if (value === undefined) {
    return 0;
  }
  return estimateTextTokens(JSON.stringify(value));
}

function previewText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= PREVIEW_LIMIT) {
    return normalized;
  }
  return `${normalized.slice(0, PREVIEW_LIMIT)}...`;
}

function blockContentText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  return JSON.stringify(content ?? "");
}

function estimateBlockTokens(block: GenericBlock): {
  user: number;
  assistant: number;
  thinking: number;
  toolResults: number;
  toolCalls: number;
  maxToolResultChars: number;
} {
  const empty = {
    user: 0,
    assistant: 0,
    thinking: 0,
    toolResults: 0,
    toolCalls: 0,
    maxToolResultChars: 0,
  };

  switch (block.type) {
    case "text":
      return { ...empty, assistant: estimateTextTokens(block.text ?? "") };
    case "thinking":
      return { ...empty, thinking: estimateTextTokens(block.thinking ?? "") };
    case "tool_use":
      return {
        ...empty,
        assistant: estimateJsonTokens({ type: "tool_use", name: block.name, input: block.input }),
        toolCalls: 1,
      };
    case "tool_result": {
      const content = blockContentText(block.content);
      return {
        ...empty,
        toolResults: estimateTextTokens(content),
        maxToolResultChars: content.length,
      };
    }
    default:
      return { ...empty, assistant: estimateJsonTokens(block) };
  }
}

function getMessageBlocks(message: MessageParam): GenericBlock[] {
  if (typeof message.content === "string") {
    return [{ type: "text", text: message.content }];
  }
  return message.content as GenericBlock[];
}

export function estimateBreakdown(snapshot: ContextSnapshot): TokenBreakdown {
  const breakdown: TokenBreakdown = {
    system: estimateTextTokens(snapshot.system),
    toolSchemas: estimateJsonTokens(snapshot.tools),
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
    breakdown.toolSchemas +
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
        preview: previewText(message.content),
      };
    }

    let tokens = 0;
    const labels: string[] = [];
    let preview = "";

    for (const block of getMessageBlocks(message)) {
      const part = estimateBlockTokens(block);
      tokens += part.user + part.assistant + part.thinking + part.toolResults;

      if (block.type === "text") {
        labels.push(`text:${part.assistant}`);
        preview ||= previewText(block.text ?? "");
      } else if (block.type === "thinking") {
        labels.push(`thinking:${part.thinking}`);
        preview ||= "(thinking)";
      } else if (block.type === "tool_use") {
        labels.push(`tool_use:${block.name ?? "unknown"}`);
        preview ||= `tool_use:${block.name ?? "unknown"}`;
      } else if (block.type === "tool_result") {
        labels.push(`tool_result:${part.toolResults}`);
        preview ||= "tool_result";
      }
    }

    return {
      index,
      role: message.role,
      tokens,
      label: labels.join(" + ") || message.role,
      preview: preview || message.role,
    };
  });
}

export async function exactTokenCount(
  messages: MessageParam[],
  system: string,
  tools: Tool[],
): Promise<number> {
  return countTokens(messages, tools, system);
}
