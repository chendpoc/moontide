import {
  runSummaryCompaction,
  previewCompact,
  type SummaryCompactionResult,
  type CompactPreview,
} from "@moontide/context-composer";
import type { CompactionPolicy } from "@moontide/context-composer";
import type { SessionStores } from "@moontide/session/stores";
import { resolveInstructionState } from "../instruction-state/index.js";
import { getWorkdir } from "../config.js";
import { resolveModelProfile } from "@moontide/llm/models";
import type { ToolSchema } from "@moontide/llm/protocol";
import type { Session } from "@moontide/session";
import { composeForSession } from "./compose-for-turn.js";
import { createTextCompletionPort } from "./text-completion-port.js";

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
    const modelProfile = resolveModelProfile();
    const result = await runSummaryCompaction({
      sessionId: this.session.sessionId,
      turn,
      sessionMessages: this.session.getMessages(),
      system: resolveInstructionState(getWorkdir()).basePrompt,
      tools: this.toolDefinitions,
      keepTurns: policy.keepTurns,
      modelId: modelProfile.logicalModelId,
      textCompletion: createTextCompletionPort(modelProfile.logicalModelId),
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
    const modelProfile = resolveModelProfile();
    const composed = await composeForSession({
      session: this.session,
      stores: this.stores,
      turn,
      toolDefinitions: this.toolDefinitions,
      compactionPolicy: { ...this.state.getPolicy(), autoEnabled: false },
      activeCompactionSaveId: this.state.getActiveCompactionSaveId(),
      resumeFromCheckpointId: this.state.getResumeCheckpointId(),
      systemPrompt: resolveInstructionState(getWorkdir()).basePrompt,
    });

    const preview = previewCompact(
      composed.request.messages,
      composed.request.system,
      composed.request.tools,
      {
        keepTurns: this.state.getPolicy().keepTurns,
        modelId: modelProfile.logicalModelId,
      },
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

export type { SummaryCompactionResult, CompactPreview };
