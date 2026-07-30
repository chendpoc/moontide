import type { MessageParam, Tool } from "@anthropic-ai/sdk/resources/messages/messages.js";

import {
  compactKeepTurns,
  compactThreshold,
  modelId,
} from "../config.js";
import { buildContextReport } from "./analyze.js";
import { estimateBreakdown } from "./metrics.js";
import { buildSnapshot } from "./snapshot.js";
import { extractText, getClient } from "../llm/client/anthropic.js";
import { buildSystemPrompt } from "../agent/prompt.js";

const COMPACT_PLACEHOLDER_PREFIX = "[compact:";

export interface CompactResult {
  messages: MessageParam[];
  beforeTokens: number;
  afterTokens: number;
  truncatedToolResults: number;
  changed: boolean;
  keepFromIndex: number;
}

export interface CompactPreview {
  beforeTokens: number;
  afterTokens: number;
  truncatedToolResults: number;
  keepFromIndex: number;
  wouldChange: boolean;
}

function estimateMessagesTokens(
  messages: MessageParam[],
  system: string,
  tools: Tool[],
): number {
  const snapshot = {
    turn: 0,
    messages,
    system,
    tools,
    modelId: modelId(),
  };
  return estimateBreakdown(snapshot).total;
}

function isToolResultsOnly(content: MessageParam["content"]): boolean {
  if (typeof content === "string") {
    return false;
  }
  if (!Array.isArray(content) || content.length === 0) {
    return false;
  }
  return content.every((block) => block.type === "tool_result");
}

function isUserTextTurnStart(message: MessageParam): boolean {
  if (message.role !== "user") {
    return false;
  }
  return !isToolResultsOnly(message.content);
}

function findKeepFromIndex(messages: MessageParam[], keepTurns: number): number {
  let userTurns = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (!isUserTextTurnStart(messages[i])) {
      continue;
    }
    userTurns += 1;
    if (userTurns >= keepTurns) {
      return i;
    }
  }
  return 0;
}

function shrinkToolResultContent(content: string, toolHint?: string): string {
  if (content.startsWith(COMPACT_PLACEHOLDER_PREFIX)) {
    return content;
  }
  const hint = toolHint ? `, tool=${toolHint}` : "";
  return `${COMPACT_PLACEHOLDER_PREFIX} ${content.length} chars omitted${hint}]`;
}

function shrinkMessageToolResults(message: MessageParam): {
  message: MessageParam;
  truncated: number;
} {
  if (message.role !== "user" || typeof message.content === "string") {
    return { message, truncated: 0 };
  }
  if (!Array.isArray(message.content)) {
    return { message, truncated: 0 };
  }

  let truncated = 0;
  const content = message.content.map((block) => {
    if (block.type !== "tool_result") {
      return block;
    }
    const body = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
    if (body.length <= 120 || body.startsWith(COMPACT_PLACEHOLDER_PREFIX)) {
      return block;
    }
    truncated += 1;
    return {
      ...block,
      content: shrinkToolResultContent(body),
    };
  });

  return { message: { ...message, content }, truncated };
}

function stripThinkingFromAssistant(message: MessageParam): MessageParam {
  if (message.role !== "assistant" || typeof message.content === "string") {
    return message;
  }
  if (!Array.isArray(message.content)) {
    return message;
  }
  const content = message.content.filter((block) => block.type !== "thinking");
  return { ...message, content };
}

export function previewCompact(
  messages: MessageParam[],
  system: string,
  tools: Tool[],
  keepTurns = compactKeepTurns(),
): CompactPreview {
  const beforeTokens = estimateMessagesTokens(messages, system, tools);
  const result = applyPrune(messages, system, tools, keepTurns);
  return {
    beforeTokens,
    afterTokens: result.afterTokens,
    truncatedToolResults: result.truncatedToolResults,
    keepFromIndex: result.keepFromIndex,
    wouldChange: result.changed,
  };
}

function applyPrune(
  messages: MessageParam[],
  system: string,
  tools: Tool[],
  keepTurns: number,
): CompactResult {
  if (messages.length === 0) {
    return {
      messages,
      beforeTokens: 0,
      afterTokens: 0,
      truncatedToolResults: 0,
      changed: false,
      keepFromIndex: 0,
    };
  }

  const beforeTokens = estimateMessagesTokens(messages, system, tools);
  const keepFrom = findKeepFromIndex(messages, keepTurns);
  let truncatedToolResults = 0;

  const next = messages.map((message, index) => {
    let current = message;
    if (index < keepFrom) {
      const shrunk = shrinkMessageToolResults(current);
      current = stripThinkingFromAssistant(shrunk.message);
      truncatedToolResults += shrunk.truncated;
      return current;
    }
    return current;
  });

  const afterTokens = estimateMessagesTokens(next, system, tools);
  const changed = afterTokens < beforeTokens || truncatedToolResults > 0;

  return {
    messages: next,
    beforeTokens,
    afterTokens,
    truncatedToolResults,
    changed,
    keepFromIndex: keepFrom,
  };
}

export function pruneCompact(
  messages: MessageParam[],
  system: string,
  tools: Tool[],
  keepTurns = compactKeepTurns(),
): CompactResult {
  return applyPrune(messages, system, tools, keepTurns);
}

function formatMessagesForSummary(messages: MessageParam[]): string {
  return messages
    .map((message, index) => {
      const role = message.role;
      const body =
        typeof message.content === "string"
          ? message.content
          : JSON.stringify(message.content).slice(0, 4000);
      return `[${index}] ${role}: ${body}`;
    })
    .join("\n\n");
}

export async function summarizeCompact(
  messages: MessageParam[],
  system: string,
  tools: Tool[],
  keepTurns = compactKeepTurns(),
): Promise<CompactResult> {
  const beforeTokens = estimateMessagesTokens(messages, system, tools);
  const keepFrom = findKeepFromIndex(messages, keepTurns);
  const head = messages.slice(0, keepFrom);
  const tail = messages.slice(keepFrom);

  if (head.length === 0) {
    return applyPrune(messages, system, tools, keepTurns);
  }

  const response = await getClient().messages.create({
    model: modelId(),
    system:
      "Summarize the conversation excerpt for context compression. Preserve tasks, decisions, file paths, and open questions. Be concise.",
    messages: [
      {
        role: "user",
        content: formatMessagesForSummary(head),
      },
    ],
    max_tokens: 2000,
  });

  const summary = extractText(response.content);
  const summaryMessage: MessageParam = {
    role: "user",
    content: `[Session summary — older turns compressed]\n${summary}`,
  };

  const next = [summaryMessage, ...tail];
  const afterTokens = estimateMessagesTokens(next, system, tools);

  return {
    messages: next,
    beforeTokens,
    afterTokens,
    truncatedToolResults: 0,
    changed: true,
    keepFromIndex: keepFrom,
  };
}

/** Pure: decide whether auto-compact should run and compute the pruned messages. */
export function computeAutoCompact(
  messages: MessageParam[],
  system: string,
  tools: Tool[],
  enabled: boolean,
): CompactResult | null {
  if (!enabled || messages.length === 0) {
    return null;
  }

  const snapshot = buildSnapshot({ turn: 0, messages, system, tools });
  const report = buildContextReport(snapshot);
  if (report.percentUsed < compactThreshold()) {
    return null;
  }

  const result = pruneCompact(messages, system, tools);
  if (!result.changed) {
    return null;
  }

  return result;
}

export function defaultCompactSystem(): string {
  return buildSystemPrompt();
}
