import type { Message, ToolSchema } from "../../../llm/protocol/types.js";
import type { CompactionSave } from "../../../session/stores/compaction-types.js";
import type { SessionMessage } from "../../../session/types.js";
import type { CompactionPolicy } from "./policy.js";
import { applyPrune, estimateContextTokens } from "./apply-prune.js";
import { applySummary } from "./apply-summary.js";
import { messagesFromContext } from "../../../session/transform/messages-from-context.js";

export interface CompactionApplyInput {
  sessionMessages: readonly SessionMessage[];
  messages: Message[];
  policy: CompactionPolicy;
  activeSave?: CompactionSave;
  system: string;
  tools: ToolSchema[];
  modelId: string;
}

export interface CompactionApplyResult {
  sessionMessages: SessionMessage[];
  messages: Message[];
  activeCompactionSaveId?: string;
  truncatedToolResults: number;
  keepFromIndex: number;
  estimatedInputTokens: number;
}

function shouldAutoPrune(
  messages: Message[],
  system: string,
  tools: ToolSchema[],
  modelId: string,
  contextWindow: number,
  thresholdPercent: number,
): boolean {
  if (messages.length === 0 || contextWindow <= 0) {
    return false;
  }
  const tokens = estimateContextTokens(messages, system, tools, modelId);
  const percentUsed = (tokens / contextWindow) * 100;
  return percentUsed >= thresholdPercent;
}

/** Apply compaction policy to compose-time message slice (immutable). */
export function applyCompactionPolicy(
  input: CompactionApplyInput,
  contextWindow: number,
): CompactionApplyResult {
  let sessionMessages = [...input.sessionMessages];
  let messages = [...input.messages];
  const activeCompactionSaveId = input.activeSave?.id;

  if (input.activeSave) {
    sessionMessages = applySummary(sessionMessages, input.activeSave);
    messages = messagesFromContext({ messages: sessionMessages });
  }

  let truncatedToolResults = 0;
  let keepFromIndex = 0;
  let estimatedInputTokens = estimateContextTokens(messages, input.system, input.tools, input.modelId);

  const autoPrune =
    input.policy.autoEnabled &&
    !input.activeSave &&
    shouldAutoPrune(
      messages,
      input.system,
      input.tools,
      input.modelId,
      contextWindow,
      input.policy.thresholdPercent,
    );

  if (autoPrune || input.policy.forcePrune) {
    const pruned = applyPrune(
      messages,
      input.system,
      input.tools,
      input.policy.keepTurns,
      input.modelId,
    );
    if (pruned.changed) {
      messages = pruned.messages;
      truncatedToolResults = pruned.truncatedToolResults;
      keepFromIndex = pruned.keepFromIndex;
      estimatedInputTokens = pruned.afterTokens;
    }
  }

  return {
    sessionMessages,
    messages,
    activeCompactionSaveId,
    truncatedToolResults,
    keepFromIndex,
    estimatedInputTokens,
  };
}

export { applyTailWindow } from "./apply-tail-window.js";
export { applySummary } from "./apply-summary.js";
export { applyPrune } from "./apply-prune.js";
