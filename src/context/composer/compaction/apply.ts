import type { Message, ToolSchema } from "../../../llm/protocol/types.js";
import type { CompactionSave } from "../../../session/stores/compaction-types.js";
import type { SessionMessage } from "../../../session/types.js";
import type { ModelProfile } from "../../../llm/models/types.js";
import { shouldCompactDialogue } from "../budget/policy.js";
import type { CompactionPolicy } from "./policy.js";
import { applyPrune, estimateDialogueCompactionTokens } from "./apply-prune.js";
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

type BudgetModelProfile = Pick<
  ModelProfile,
  "logicalModelId" | "contextWindow" | "maxOutputTokens" | "supportsThinking"
>;

function shouldAutoPrune(
  messages: Message[],
  system: string,
  tools: ToolSchema[],
  modelProfile: BudgetModelProfile,
  thresholdPercent: number,
): boolean {
  return shouldCompactDialogue({
    modelProfile,
    system,
    tools,
    messages,
    thresholdPercent,
  });
}

/** Apply compaction policy to compose-time message slice (immutable). */
export function applyCompactionPolicy(
  input: CompactionApplyInput,
  modelProfile: BudgetModelProfile,
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
  let estimatedInputTokens = estimateDialogueCompactionTokens(messages, input.modelId);

  const autoPrune =
    input.policy.autoEnabled &&
    !input.activeSave &&
    shouldAutoPrune(
      messages,
      input.system,
      input.tools,
      modelProfile,
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
