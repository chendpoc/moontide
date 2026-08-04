import { getWorkdir } from "../config.js";
import { composeContext } from "../context/composer/compose.js";
import type { CompactionPolicy } from "../context/composer/compaction/policy.js";
import type { ComposedContext } from "../context/composer/types.js";
import type { SessionStores } from "../context/stores/index.js";
import { resolveModelProfile } from "../llm/models/resolve.js";
import { resolveInstructionState } from "../instruction-state/index.js";
import type { ToolSchema } from "../llm/protocol/types.js";
import type { Session } from "../session/session.js";

export interface ComposeForSessionInput {
  session: Session;
  stores: SessionStores;
  turn: number;
  toolDefinitions: ToolSchema[];
  compactionPolicy: CompactionPolicy;
  resumeFromCheckpointId?: string;
  activeCompactionSaveId?: string;
  /** Override system prompt (e.g. compact preview). */
  systemPrompt?: string;
}

/** Shared compose entry for AgentRun and compaction preview paths. */
export async function composeForSession(input: ComposeForSessionInput): Promise<ComposedContext> {
  const instructionState = input.systemPrompt
    ? { basePrompt: input.systemPrompt, epoch: 1 }
    : resolveInstructionState(getWorkdir());

  return composeContext({
    sessionId: input.session.sessionId,
    turn: input.turn,
    messages: input.session.getMessages(),
    instructionState,
    artifactStore: input.stores.artifacts,
    compactionStore: input.stores.compaction,
    checkpointStore: input.stores.checkpoints,
    toolDefinitions: input.toolDefinitions,
    modelProfile: resolveModelProfile(),
    compactionPolicy: input.compactionPolicy,
    resumeFromCheckpointId: input.resumeFromCheckpointId,
    activeCompactionSaveId: input.activeCompactionSaveId,
  });
}
