import { messagesFromContext } from "../../session/transform/messages-from-context.js";
import { applyCompactionPolicy, applyTailWindow } from "./compaction/apply.js";
import { buildContextManifest } from "./manifest.js";
import { toMessageParams } from "./messages/to-message-params.js";
import { buildSystemFromInstructionState } from "./system/build-system.js";
import { resolveToolDefinitions } from "./tool-definitions/resolve.js";
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

  const allItemIds = input.messages.map((message) => message.id);
  const includedItemIds = sessionMessages.map((message) => message.id);
  const excludedItemIds = allItemIds.filter((id) => !includedItemIds.includes(id));

  const activeSave = activeCompactionSaveId
    ? await input.compactionStore.get(input.sessionId, activeCompactionSaveId)
    : undefined;

  const system = buildSystemFromInstructionState(input.instructionState);
  const tools =
    input.toolDefinitions.length > 0 ? input.toolDefinitions : resolveToolDefinitions();
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

  const manifest = buildContextManifest({
    sessionId: input.sessionId,
    turn: input.turn,
    modelProfile: input.modelProfile,
    tools,
    includedItemIds: sessionMessages.map((message) => message.id),
    excludedItemIds: excludedItemIds.length > 0 ? excludedItemIds : undefined,
    activeCompactionSaveId: compaction.activeCompactionSaveId,
    resumeCheckpointId,
    estimatedInputTokens: compaction.estimatedInputTokens,
  });

  return {
    request: {
      system,
      messages: toMessageParams(protocolMessages),
      tools,
    },
    manifest,
  };
}
