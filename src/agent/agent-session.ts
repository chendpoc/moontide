import { getWorkdir } from "../config.js";
import type { Checkpoint } from "../session/stores/checkpoint-types.js";
import { createSessionStores, type SessionStores } from "../session/stores/index.js";
import type { CompactionPolicy } from "../context/composer/compaction/policy.js";
import type { SummaryCompactionResult } from "../context/composer/compaction/run-summary-compaction.js";
import type { CompactPreview } from "../context/composer/compaction/operations.js";
import { resolveCompactionPolicy } from "../llm/models/resolve.js";
import { getToolDefinitions } from "../tools/index.js";
import { Session } from "../session/session.js";
import type { LoopContext } from "./deps.js";
import { AgentRun, type AgentRunComposeOptions } from "./agent-run.js";
import { CheckpointService } from "./checkpoint-service.js";
import { CompactionService } from "./compaction-service.js";
import { createSessionCommitPort } from "./session-commit-port.js";
import { getAgentRuntime, type AgentRuntime } from "./runtime/index.js";

export interface AgentSessionOpenOptions {
  resumeFromCheckpointId?: string;
}

export class AgentSession {
  readonly session: Session;
  readonly stores: SessionStores;
  readonly runtime: AgentRuntime;
  private readonly compaction: CompactionService;
  private readonly checkpoints: CheckpointService;
  private resumeFromCheckpointId?: string;
  private activeCompactionSaveId?: string;
  private forcePrune = false;
  private compactAutoOverride: boolean | null = null;

  private constructor(
    session: Session,
    stores: SessionStores,
    runtime: AgentRuntime,
    resumeFromCheckpointId?: string,
  ) {
    this.session = session;
    this.stores = stores;
    this.runtime = runtime;
    this.resumeFromCheckpointId = resumeFromCheckpointId;
    this.compaction = new CompactionService(session, stores, getToolDefinitions(runtime.tools), {
      getPolicy: () => this.getCompactionPolicy(),
      getActiveCompactionSaveId: () => this.activeCompactionSaveId,
      setActiveCompactionSaveId: (id) => {
        this.activeCompactionSaveId = id;
      },
      getResumeCheckpointId: () => this.resumeFromCheckpointId,
      setForcePrune: (value) => {
        this.forcePrune = value;
      },
    });
    this.checkpoints = new CheckpointService(session, stores, {
      getActiveCompactionSaveId: () => this.activeCompactionSaveId,
      setActiveCompactionSaveId: (id) => {
        this.activeCompactionSaveId = id;
      },
      setResumeCheckpointId: (id) => {
        this.resumeFromCheckpointId = id;
      },
    });
  }

  static create(workdir = getWorkdir(), runtime = getAgentRuntime()): AgentSession {
    const commitPort = createSessionCommitPort(workdir, runtime);
    return new AgentSession(Session.create(workdir, commitPort), createSessionStores(workdir), runtime);
  }

  static async open(
    sessionId: string,
    workdir = getWorkdir(),
    options: AgentSessionOpenOptions = {},
    runtime = getAgentRuntime(),
  ): Promise<AgentSession> {
    const stores = createSessionStores(workdir);
    const commitPort = createSessionCommitPort(workdir, runtime);
    const session = Session.open(sessionId, workdir, commitPort);

    if (options.resumeFromCheckpointId) {
      const checkpoint = await stores.checkpoints.get(sessionId, options.resumeFromCheckpointId);
      if (checkpoint) {
        session.truncateMessages(checkpoint.lastItemId);
        const agent = new AgentSession(session, stores, runtime, options.resumeFromCheckpointId);
        agent.activeCompactionSaveId = checkpoint.activeCompactionSaveId;
        return agent;
      }
    }

    return new AgentSession(session, stores, runtime);
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
    return this.compaction.runSummary(turn);
  }

  async runPruneCompaction(turn: number): Promise<CompactPreview> {
    return this.compaction.runPrunePreview(turn);
  }

  async createCheckpoint(turn: number, label?: string): Promise<Checkpoint> {
    return this.checkpoints.create(turn, label);
  }

  async resume(checkpointId: string): Promise<boolean> {
    return this.checkpoints.resume(checkpointId);
  }

  getResumeCheckpointId(): string | undefined {
    return this.resumeFromCheckpointId;
  }

  async run(
    userPrompt: string,
    ctx: LoopContext,
  ): Promise<{ reply: string; turn: number }> {
    const loopCtx: LoopContext = {
      ...ctx,
      session: this.session,
      stores: this.stores,
      runtime: this.runtime,
    };
    return new AgentRun(this.session, this.stores, loopCtx, this.composeOptions()).execute(
      userPrompt,
    );
  }
}

export type { SummaryCompactionResult };
