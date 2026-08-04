import {
  runSummaryCompaction,
  type SummaryCompactionResult,
} from "../context/composer/compaction/run-summary-compaction.js";
import type { CompactionPolicy } from "../context/composer/compaction/policy.js";
import {
  defaultCompactSystem,
  previewCompact,
  type CompactPreview,
} from "../context/compact.js";
import type { SessionStores } from "../context/stores/index.js";
import { resolveInstructionState } from "../instruction-state/index.js";
import { getWorkdir } from "../config.js";
import type { ToolSchema } from "../llm/protocol/types.js";
import type { Session } from "../session/session.js";
import { composeForSession } from "./compose-for-turn.js";

export interface CompactionSessionState {
  getPolicy: () => CompactionPolicy;
  getActiveCompactionSaveId: () => string | undefined;
  setActiveCompactionSaveId: (id: string) => void;
  getResumeCheckpointId: () => string | undefined;
  setForcePrune: (value: boolean) => void;
}

export class CompactionService {
  constructor(
    private readonly session: Session,
    private readonly stores: SessionStores,
    private readonly toolDefinitions: ToolSchema[],
    private readonly state: CompactionSessionState,
  ) {}

  async runSummary(turn: number): Promise<SummaryCompactionResult> {
    const policy = this.state.getPolicy();
    const result = await runSummaryCompaction({
      sessionId: this.session.sessionId,
      turn,
      sessionMessages: this.session.getMessages(),
      system: resolveInstructionState(getWorkdir()).basePrompt,
      tools: this.toolDefinitions,
      keepTurns: policy.keepTurns,
    });

    await this.stores.compaction.save(result.save);
    await this.session.appendCompactionItem(
      turn,
      result.beforeTokens,
      result.afterTokens,
      "summary",
      result.save.id,
    );
    this.state.setActiveCompactionSaveId(result.save.id);
    return result;
  }

  async runPrunePreview(turn: number): Promise<CompactPreview> {
    const composed = await composeForSession({
      session: this.session,
      stores: this.stores,
      turn,
      toolDefinitions: this.toolDefinitions,
      compactionPolicy: { ...this.state.getPolicy(), autoEnabled: false },
      activeCompactionSaveId: this.state.getActiveCompactionSaveId(),
      resumeFromCheckpointId: this.state.getResumeCheckpointId(),
      systemPrompt: defaultCompactSystem(),
    });

    const preview = previewCompact(
      composed.request.messages,
      composed.request.system,
      composed.request.tools,
      this.state.getPolicy().keepTurns,
    );

    if (!preview.wouldChange) {
      return preview;
    }

    await this.session.appendCompactionItem(
      turn,
      preview.beforeTokens,
      preview.afterTokens,
      "prune",
    );
    this.state.setForcePrune(true);
    return preview;
  }
}
