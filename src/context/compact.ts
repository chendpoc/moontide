import type { MessageParam } from "@anthropic-ai/sdk/resources/messages/messages.js";

import type { Message, ToolSchema } from "../llm/protocol/types.js";

import {
  compactKeepTurns,
  compactThreshold,
  modelId,
} from "../config.js";
import { applyPrune } from "./composer/compaction/apply-prune.js";
import { buildContextReport } from "./analyze.js";
import { estimateBreakdown } from "./metrics.js";
import { buildSnapshot } from "./snapshot.js";
import { extractText, getClient } from "../llm/client/anthropic.js";
import { buildDefaultBasePrompt } from "../agent/prompt.js";

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
  tools: ToolSchema[],
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

function findKeepFromIndex(messages: MessageParam[], keepTurns: number): number {
  let userTurns = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== "user") continue;
    const content = message.content;
    if (typeof content !== "string" && Array.isArray(content)) {
      if (content.length > 0 && content.every((block) => block.type === "tool_result")) {
        continue;
      }
    }
    userTurns += 1;
    if (userTurns >= keepTurns) {
      return i;
    }
  }
  return 0;
}

export function previewCompact(
  messages: MessageParam[],
  system: string,
  tools: ToolSchema[],
  keepTurns = compactKeepTurns(),
): CompactPreview {
  const beforeTokens = estimateMessagesTokens(messages, system, tools);
  const result = pruneCompact(messages, system, tools, keepTurns);
  return {
    beforeTokens,
    afterTokens: result.afterTokens,
    truncatedToolResults: result.truncatedToolResults,
    keepFromIndex: result.keepFromIndex,
    wouldChange: result.changed,
  };
}

export function pruneCompact(
  messages: MessageParam[],
  system: string,
  tools: ToolSchema[],
  keepTurns = compactKeepTurns(),
): CompactResult {
  const pruned = applyPrune(
    messages as Message[],
    system,
    tools,
    keepTurns,
    modelId(),
  );
  return {
    messages: pruned.messages as MessageParam[],
    beforeTokens: pruned.beforeTokens,
    afterTokens: pruned.afterTokens,
    truncatedToolResults: pruned.truncatedToolResults,
    changed: pruned.changed,
    keepFromIndex: pruned.keepFromIndex,
  };
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
  tools: ToolSchema[],
  keepTurns = compactKeepTurns(),
): Promise<CompactResult> {
  const beforeTokens = estimateMessagesTokens(messages, system, tools);
  const keepFrom = findKeepFromIndex(messages, keepTurns);
  const head = messages.slice(0, keepFrom);
  const tail = messages.slice(keepFrom);

  if (head.length === 0) {
    return pruneCompact(messages, system, tools, keepTurns);
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
  tools: ToolSchema[],
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
  return buildDefaultBasePrompt();
}
