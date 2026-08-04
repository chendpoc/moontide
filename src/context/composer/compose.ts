import { messagesFromContext } from "../../session/transform/messages-from-context.js";
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

  const system = buildSystemFromInstructionState(input.instructionState);
  const tools = input.toolDefinitions;
  const modelId = input.modelProfile.logicalModelId;

  let protocolMessages = messagesFromContext({ messages: sessionMessages });

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
    input.modelProfile.contextWindow,
  );

  sessionMessages = compaction.sessionMessages;
  protocolMessages = compaction.messages;

  const compiledMessageItemIds = sessionMessages.map((message) => message.id);
  const compactionExcludedItemIds = preCompactionIds.filter(
    (id) => !compiledMessageItemIds.includes(id),
  );

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
    estimatedInputTokens: compaction.estimatedInputTokens,
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
