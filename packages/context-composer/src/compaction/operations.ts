import type { Message, ToolSchema } from "@moontide/llm/protocol";
import type { ModelProfile } from "@moontide/llm/models";
import type { BudgetConfig } from "../ports/budget-config.js";
import type { TextCompletionPort } from "../ports/text-completion.js";
import { summarizeDialogueExcerpt } from "./summary-dialogue.js";
import { shouldCompactDialogue } from "../budget/policy.js";
import {
  applyPrune,
  estimateDialogueCompactionTokens,
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

export interface CompactOperationOptions {
  keepTurns: number;
  modelId: string;
}

export function previewCompact(
  messages: Message[],
  system: string,
  tools: ToolSchema[],
  options: CompactOperationOptions,
): CompactPreview {
  const beforeTokens = estimateDialogueCompactionTokens(messages, options.modelId);
  const result = pruneCompact(messages, system, tools, options);
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
  options: CompactOperationOptions,
): CompactResult {
  const pruned = applyPrune(
    messages,
    system,
    tools,
    options.keepTurns,
    options.modelId,
  );
  return {
    messages: pruned.messages,
    beforeTokens: pruned.beforeTokens,
    afterTokens: pruned.afterTokens,
    truncatedToolResults: pruned.truncatedToolResults,
    changed: pruned.changed,
    keepFromIndex: pruned.keepFromIndex,
  };
}

const SUMMARY_PREFIX = "[Session summary — older turns compressed]\n";

export async function summarizeCompact(
  messages: Message[],
  system: string,
  tools: ToolSchema[],
  options: CompactOperationOptions,
  textCompletion: TextCompletionPort,
): Promise<CompactResult> {
  void system;
  void tools;
  const { modelId, keepTurns } = options;
  const beforeTokens = estimateDialogueCompactionTokens(messages, modelId);
  const keepFrom = findKeepFromIndex(messages, keepTurns);
  const head = messages.slice(0, keepFrom);
  const tail = messages.slice(keepFrom);

  if (head.length === 0) {
    return pruneCompact(messages, system, tools, options);
  }

  const summary = await summarizeDialogueExcerpt(head, textCompletion);
  const summaryMessage: Message = {
    role: "user",
    content: `${SUMMARY_PREFIX}${summary}`,
  };

  const next = [summaryMessage, ...tail];
  const afterTokens = estimateDialogueCompactionTokens(next, modelId);

  return {
    messages: next,
    beforeTokens,
    afterTokens,
    truncatedToolResults: 0,
    changed: true,
    keepFromIndex: keepFrom,
  };
}

export interface AutoCompactOptions {
  enabled: boolean;
  thresholdPercent: number;
  keepTurns: number;
  modelProfile: Pick<
    ModelProfile,
    "logicalModelId" | "contextWindow" | "maxOutputTokens" | "supportsThinking"
  >;
  budget?: BudgetConfig;
}

/** Pure: decide whether auto-compact should run and compute the pruned messages. */
export function computeAutoCompact(
  messages: Message[],
  system: string,
  tools: ToolSchema[],
  options: AutoCompactOptions,
): CompactResult | null {
  if (!options.enabled || messages.length === 0) {
    return null;
  }

  if (
    !shouldCompactDialogue({
      modelProfile: options.modelProfile,
      system,
      tools,
      messages,
      thresholdPercent: options.thresholdPercent,
      budget: options.budget,
    })
  ) {
    return null;
  }

  const compactOptions: CompactOperationOptions = {
    keepTurns: options.keepTurns,
    modelId: options.modelProfile.logicalModelId,
  };
  const result = pruneCompact(messages, system, tools, compactOptions);
  if (!result.changed) {
    return null;
  }

  return result;
}
