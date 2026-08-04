import type { MessageParam } from "@anthropic-ai/sdk/resources/messages/messages.js";

import { getWorkdir } from "../config.js";
import type { Checkpoint } from "../context/stores/checkpoint-types.js";
import { createSessionStores, type SessionStores } from "../context/stores/index.js";
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
import { composeContext } from "../context/composer/compose.js";
import { resolveCompactionPolicy, resolveModelProfile } from "../llm/models/resolve.js";
import { resolveInstructionState } from "../instruction-state/index.js";
import { getToolDefinitions } from "../tools/index.js";
import { Session } from "../session/session.js";
import type { LoopContext } from "./deps.js";
import { AgentRun, type AgentRunComposeOptions } from "./agent-run.js";
import { newEventId } from "../utils/id.js";

export interface AgentSessionOpenOptions {
  resumeFromCheckpointId?: string;
}

export class AgentSession {
  readonly session: Session;
  readonly stores: SessionStores;
  private resumeFromCheckpointId?: string;
  private activeCompactionSaveId?: string;
  private forcePrune = false;
  private compactAutoOverride: boolean | null = null;

  private constructor(
    session: Session,
    stores: SessionStores,
    resumeFromCheckpointId?: string,
  ) {
    this.session = session;
    this.stores = stores;
    this.resumeFromCheckpointId = resumeFromCheckpointId;
  }

  static create(workdir = getWorkdir()): AgentSession {
    return new AgentSession(Session.create(workdir), createSessionStores(workdir));
  }

  static async open(
    sessionId: string,
    workdir = getWorkdir(),
    options: AgentSessionOpenOptions = {},
  ): Promise<AgentSession> {
    const stores = createSessionStores(workdir);
    const session = Session.open(sessionId, workdir);

    if (options.resumeFromCheckpointId) {
      const checkpoint = await stores.checkpoints.get(sessionId, options.resumeFromCheckpointId);
      if (checkpoint) {
        session.truncateMessages(checkpoint.lastItemId);
        const agent = new AgentSession(session, stores, options.resumeFromCheckpointId);
        agent.activeCompactionSaveId = checkpoint.activeCompactionSaveId;
        return agent;
      }
    }

    return new AgentSession(session, stores);
  }

  getCompactionPolicy(): CompactionPolicy {
    const base = resolveCompactionPolicy();
    return {
      ...base,
      autoEnabled: this.compactAutoOverride ?? base.autoEnabled,
      forcePrune: this.forcePrune || undefined,
    };
  }

  setCompactAuto(enabled: boolean | null): void {
    this.compactAutoOverride = enabled;
  }

  isCompactAutoEnabled(): boolean {
    return this.getCompactionPolicy().autoEnabled;
  }

  getActiveCompactionSaveId(): string | undefined {
    return this.activeCompactionSaveId;
  }

  clearForcePrune(): void {
    this.forcePrune = false;
  }

  private composeOptions(): AgentRunComposeOptions {
    return {
      resumeFromCheckpointId: this.resumeFromCheckpointId,
      activeCompactionSaveId: this.activeCompactionSaveId,
      getCompactionPolicy: () => this.getCompactionPolicy(),
      onAfterCompose: () => this.clearForcePrune(),
    };
  }

  async runSummaryCompaction(turn: number): Promise<SummaryCompactionResult> {
    const policy = this.getCompactionPolicy();
    const result = await runSummaryCompaction({
      sessionId: this.session.sessionId,
      turn,
      sessionMessages: this.session.getMessages(),
      system: resolveInstructionState(getWorkdir()).basePrompt,
      tools: getToolDefinitions(),
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
    this.activeCompactionSaveId = result.save.id;
    return result;
  }

  async runPruneCompaction(turn: number): Promise<CompactPreview> {
    const composed = await composeContext({
      sessionId: this.session.sessionId,
      turn,
      messages: this.session.getMessages(),
      instructionState: { basePrompt: defaultCompactSystem(), epoch: 1 },
      artifactStore: this.stores.artifacts,
      compactionStore: this.stores.compaction,
      checkpointStore: this.stores.checkpoints,
      toolDefinitions: getToolDefinitions(),
      modelProfile: resolveModelProfile(),
      compactionPolicy: { ...this.getCompactionPolicy(), autoEnabled: false },
      activeCompactionSaveId: this.activeCompactionSaveId,
      resumeFromCheckpointId: this.resumeFromCheckpointId,
    });

    const preview = previewCompact(
      composed.request.messages as MessageParam[],
      composed.request.system,
      composed.request.tools,
      this.getCompactionPolicy().keepTurns,
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
    this.forcePrune = true;
    return preview;
  }

  async createCheckpoint(turn: number, label?: string): Promise<Checkpoint> {
    const lastMessage = this.session.getMessages().at(-1);
    if (!lastMessage) {
      throw new Error("Cannot create checkpoint: session has no messages");
    }

    const checkpoint: Checkpoint = {
      id: newEventId(),
      sessionId: this.session.sessionId,
      createdAtTurn: turn,
      lastItemId: lastMessage.id,
      instructionEpoch: 1,
      activeCompactionSaveId: this.activeCompactionSaveId,
      label,
    };

    await this.stores.checkpoints.save(checkpoint);
    await this.session.appendCheckpointItem(turn, checkpoint.id);
    return checkpoint;
  }

  async resume(checkpointId: string): Promise<boolean> {
    const checkpoint = await this.stores.checkpoints.get(this.session.sessionId, checkpointId);
    if (!checkpoint) {
      return false;
    }

    this.session.truncateMessages(checkpoint.lastItemId);
    this.resumeFromCheckpointId = checkpointId;
    this.activeCompactionSaveId = checkpoint.activeCompactionSaveId;
    return true;
  }

  getResumeCheckpointId(): string | undefined {
    return this.resumeFromCheckpointId;
  }

  async run(
    userPrompt: string,
    ctx: LoopContext,
  ): Promise<{ reply: string; turn: number }> {
    const loopCtx: LoopContext = { ...ctx, session: this.session, stores: this.stores };
    return new AgentRun(this.session, this.stores, loopCtx, this.composeOptions()).execute(
      userPrompt,
    );
  }
}
