import { messagesFromContext } from "../../session/transform/messages-from-context.js";
import { contextBudgetFlexEnabled } from "../../config.js";
import {
  buildBudgetAlerts,
  enforceL3ReferenceBudget,
  findTierUsage,
  resolveBudgetPolicy,
  sumInputTierTokens,
} from "./budget/index.js";
import { appendWorkingSetToSystem } from "./working-set.js";
import { applyCompactionPolicy, applyTailWindow } from "./compaction/apply.js";
import { buildContextManifest } from "./manifest.js";
import { buildSystemFromInstructionState } from "./system/build-system.js";
import type { ComposedContext, ComposeContextInput } from "./types.js";

/** Full Context Composer — compile SessionContext messages into LLMRequest + Manifest. */
export async function composeContext(input: ComposeContextInput): Promise<ComposedContext> {
  let sessionMessages = [...input.messages];
  let resumeCheckpointId: string | undefined;
  let activeCompactionSaveId = input.activeCompactionSaveId;

  if (input.resumeFromCheckpointId) {
    const checkpoint = await input.checkpointStore.get(
      input.sessionId,
      input.resumeFromCheckpointId,
    );
    if (checkpoint) {
      sessionMessages = applyTailWindow(sessionMessages, checkpoint.lastItemId);
      resumeCheckpointId = checkpoint.id;
      if (checkpoint.activeCompactionSaveId) {
        activeCompactionSaveId = checkpoint.activeCompactionSaveId;
      }
    }
  }

  const sourceItemIds = input.messages.map((message) => message.id);
  const postCheckpointIds = sessionMessages.map((message) => message.id);
  const checkpointExcludedItemIds = sourceItemIds.filter((id) => !postCheckpointIds.includes(id));
  const preCompactionIds = [...postCheckpointIds];

  const activeSave = activeCompactionSaveId
    ? await input.compactionStore.get(input.sessionId, activeCompactionSaveId)
    : undefined;

  const systemBase = buildSystemFromInstructionState(input.instructionState);
  const system = appendWorkingSetToSystem(systemBase, input.workingSetSnapshot);
  const tools = input.toolDefinitions;
  const modelId = input.modelProfile.logicalModelId;

  let protocolMessages = messagesFromContext({ messages: sessionMessages });

  const flexEnabled = contextBudgetFlexEnabled();
  const preBudget = resolveBudgetPolicy({
    modelProfile: input.modelProfile,
    system,
    tools,
    messages: protocolMessages,
    systemBase,
    workingSetSnapshot: input.workingSetSnapshot,
    includeFlex: flexEnabled,
  });
  const l3Cap = findTierUsage(preBudget, "reference").limitTokens;
  const l3Enforced = await enforceL3ReferenceBudget({
    messages: protocolMessages,
    l3Cap,
    modelId,
    sessionId: input.sessionId,
    artifactStore: input.artifactStore,
  });
  protocolMessages = l3Enforced.messages;

  const compaction = applyCompactionPolicy(
    {
      sessionMessages,
      messages: protocolMessages,
      policy: input.compactionPolicy,
      activeSave,
      system,
      tools,
      modelId,
    },
    input.modelProfile,
  );

  sessionMessages = compaction.sessionMessages;
  protocolMessages = compaction.messages;

  const compiledMessageItemIds = sessionMessages.map((message) => message.id);
  const compactionExcludedItemIds = preCompactionIds.filter(
    (id) => !compiledMessageItemIds.includes(id),
  );

  const budgetPolicy = resolveBudgetPolicy({
    modelProfile: input.modelProfile,
    system,
    tools,
    messages: protocolMessages,
    systemBase,
    workingSetSnapshot: input.workingSetSnapshot,
    includeFlex: flexEnabled,
  });
  const budgetAlerts = buildBudgetAlerts(budgetPolicy);

  const manifest = buildContextManifest({
    sessionId: input.sessionId,
    turn: input.turn,
    modelProfile: input.modelProfile,
    tools,
    sourceItemIds,
    checkpointExcludedItemIds:
      checkpointExcludedItemIds.length > 0 ? checkpointExcludedItemIds : undefined,
    compiledMessageItemIds,
    compactionExcludedItemIds:
      compactionExcludedItemIds.length > 0 ? compactionExcludedItemIds : undefined,
    activeCompactionSaveId: compaction.activeCompactionSaveId,
    resumeCheckpointId,
    estimatedInputTokens: sumInputTierTokens(budgetPolicy),
    budgetTiers: budgetPolicy.tiers,
    alerts: budgetAlerts.length > 0 ? budgetAlerts : undefined,
  });

  return {
    request: {
      system,
      messages: protocolMessages,
      tools,
    },
    manifest,
  };
}
