import type { Message, ToolSchema } from "../../../llm/protocol/types.js";

import {
  compactKeepTurns,
  compactThreshold,
  modelId,
} from "../../../config.js";
import { buildContextReport } from "../../../context-inspect/analyze.js";
import { buildSnapshot } from "../../../context-inspect/snapshot.js";
import { extractText } from "../../../llm/normalize/extract-text.js";
import { getLLMProvider } from "../../../llm/provider.js";
import { resolveRoute } from "../../../llm/routing/resolve.js";
import {
  applyPrune,
  estimateContextTokens,
  findKeepFromIndex,
} from "./apply-prune.js";

export interface CompactResult {
  messages: Message[];
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

export function previewCompact(
  messages: Message[],
  system: string,
  tools: ToolSchema[],
  keepTurns = compactKeepTurns(),
): CompactPreview {
  const beforeTokens = estimateContextTokens(messages, system, tools, modelId());
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
  messages: Message[],
  system: string,
  tools: ToolSchema[],
  keepTurns = compactKeepTurns(),
): CompactResult {
  const pruned = applyPrune(messages, system, tools, keepTurns, modelId());
  return {
    messages: pruned.messages,
    beforeTokens: pruned.beforeTokens,
    afterTokens: pruned.afterTokens,
    truncatedToolResults: pruned.truncatedToolResults,
    changed: pruned.changed,
    keepFromIndex: pruned.keepFromIndex,
  };
}

function formatMessagesForSummary(messages: Message[]): string {
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
  messages: Message[],
  system: string,
  tools: ToolSchema[],
  keepTurns = compactKeepTurns(),
): Promise<CompactResult> {
  const currentModelId = modelId();
  const beforeTokens = estimateContextTokens(messages, system, tools, currentModelId);
  const keepFrom = findKeepFromIndex(messages, keepTurns);
  const head = messages.slice(0, keepFrom);
  const tail = messages.slice(keepFrom);

  if (head.length === 0) {
    return pruneCompact(messages, system, tools, keepTurns);
  }

  const route = resolveRoute(currentModelId);
  const response = await getLLMProvider(route).chat({
    model: route.vendorModelId,
    system:
      "Summarize the conversation excerpt for context compression. Preserve tasks, decisions, file paths, and open questions. Be concise.",
    messages: [
      {
        role: "user",
        content: formatMessagesForSummary(head),
      },
    ],
    tools: [],
    maxTokens: 2000,
  });

  const summary = extractText(response.content);
  const summaryMessage: Message = {
    role: "user",
    content: `[Session summary — older turns compressed]\n${summary}`,
  };

  const next = [summaryMessage, ...tail];
  const afterTokens = estimateContextTokens(next, system, tools, currentModelId);

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
  messages: Message[],
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
