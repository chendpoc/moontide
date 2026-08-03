import type { MessageParam, Tool } from "@anthropic-ai/sdk/resources/messages/messages.js";

import type { ToolSchema } from "../llm/protocol/types.js";

import { countTokens } from "../llm/client/anthropic.js";
import { truncateOneLine } from "../utils/text.js";
import type {
  ContextSnapshot,
  ContextStructure,
  MessageLine,
  MessageLineDetail,
  TokenBreakdown,
} from "./types.js";

const PREVIEW_LIMIT = 48;

type GenericBlock = {
  type?: string;
  text?: string;
  thinking?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
  tool_use_id?: string;
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
  return truncateOneLine(text, PREVIEW_LIMIT, "...");
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

function formatToolResultPreview(toolUseId: string | undefined, content: string): string {
  const snippet = truncateOneLine(content, PREVIEW_LIMIT, "...");
  if (!toolUseId) {
    return snippet;
  }
  const shortId = toolUseId.length > 10 ? `${toolUseId.slice(0, 10)}…` : toolUseId;
  return `${shortId} · ${snippet}`;
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
    const details: MessageLineDetail[] = [];

    for (const block of getMessageBlocks(message)) {
      const part = estimateBlockTokens(block);
      tokens += part.user + part.assistant + part.thinking + part.toolResults;

      if (block.type === "text") {
        labels.push(`text:${part.assistant}`);
        preview ||= previewText(block.text ?? "");
        details.push({
          kind: "text",
          tokens: part.assistant,
          charCount: (block.text ?? "").length,
          preview: previewText(block.text ?? ""),
          body: block.text ?? "",
        });
      } else if (block.type === "thinking") {
        labels.push(`thinking:${part.thinking}`);
        preview ||= "(thinking)";
        details.push({
          kind: "thinking",
          tokens: part.thinking,
          charCount: (block.thinking ?? "").length,
          preview: "(thinking)",
          body: block.thinking ?? "",
        });
      } else if (block.type === "tool_use") {
        const toolName = block.name ?? "unknown";
        labels.push(`tool_use:${toolName}`);
        preview ||= `tool_use:${toolName}`;
        details.push({
          kind: "tool_use",
          tokens: part.assistant,
          charCount: JSON.stringify({ type: "tool_use", name: block.name, input: block.input }).length,
          toolName,
          preview: `tool_use:${toolName}`,
        });
      } else if (block.type === "tool_result") {
        const content = blockContentText(block.content);
        labels.push(`tool_result:${part.toolResults}`);
        preview ||= formatToolResultPreview(block.tool_use_id, content);
        details.push({
          kind: "tool_result",
          tokens: part.toolResults,
          charCount: content.length,
          toolUseId: block.tool_use_id,
          preview: previewText(content),
          body: content,
        });
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
  messages: MessageParam[],
  system: string,
  tools: ToolSchema[],
): Promise<number> {
  return countTokens(messages, tools as Tool[], system);
}
