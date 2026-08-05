import { getWorkdir } from "../config.js";
import { composeContext } from "../context/composer/compose.js";
import type { CompactionPolicy } from "../context/composer/compaction/policy.js";
import type { ComposedContext } from "../context/composer/types.js";
import type { SessionStores } from "../session/stores/index.js";
import { resolveModelProfile } from "../llm/models/resolve.js";
import type { ModelProfile } from "../llm/models/types.js";
import { resolveInstructionState } from "../instruction-state/index.js";
import type { ToolSchema } from "../llm/protocol/types.js";
import type { Session } from "../session/session.js";
import { getActiveWorkMemId, getDeepTaskGoal, isDeepModeEnabled } from "./deep-mode.js";
import { resolveWorkingSetForCompose } from "./working-set-compose.js";

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
  /** Override model profile (e.g. compaction preview / tests). */
  modelProfile?: ModelProfile;
}

/** Shared compose entry for AgentRun and compaction preview paths. */
export async function composeForSession(input: ComposeForSessionInput): Promise<ComposedContext> {
  const instructionState = input.systemPrompt
    ? { basePrompt: input.systemPrompt, epoch: 1 }
    : resolveInstructionState(getWorkdir());

  const modelProfile = input.modelProfile ?? resolveModelProfile();
  let workingSetSnapshot: string | undefined;
  let deepTask: { goal: string; workMemId: string } | undefined;

  if (isDeepModeEnabled()) {
    const workMemId = getActiveWorkMemId(input.session.sessionId);
    const goal = getDeepTaskGoal(input.session.sessionId);
    if (workMemId && goal) {
      deepTask = { goal, workMemId };
      const resolved = resolveWorkingSetForCompose({
        sessionId: input.session.sessionId,
        workMemId,
        modelProfile,
        instructionState,
        messages: input.session.getMessages(),
        tools: input.toolDefinitions,
        compactionPolicy: input.compactionPolicy,
        activeCompactionSaveId: input.activeCompactionSaveId,
      });
      workingSetSnapshot = resolved?.text;
    }
  }

  return composeContext({
    sessionId: input.session.sessionId,
    turn: input.turn,
    messages: input.session.getMessages(),
    instructionState,
    artifactStore: input.stores.artifacts,
    compactionStore: input.stores.compaction,
    checkpointStore: input.stores.checkpoints,
    toolDefinitions: input.toolDefinitions,
    modelProfile,
    compactionPolicy: input.compactionPolicy,
    resumeFromCheckpointId: input.resumeFromCheckpointId,
    activeCompactionSaveId: input.activeCompactionSaveId,
    workingSetSnapshot,
    deepTask,
  });
}
