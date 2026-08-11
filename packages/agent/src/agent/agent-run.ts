import type { RunEventListener } from "@moontide/agent-core";
import {
  createMessageLog,
  createRunEventBus,
  resolveRunConfig,
  runLoop,
} from "@moontide/agent-core";
import type { CompactionPolicy } from "@moontide/context-composer";
import { createRunEventDeriveListener, resetRun } from "../log/index.js";
import type { SessionStores } from "@moontide/session/stores";
import type { Session } from "@moontide/session";
import type { LoopContext } from "./deps.js";
import { withRun } from "./lifecycle.js";
import { createComposeState } from "./harness/compose-state.js";
import { createMoonTideRunConfig, createDeepModeRunState } from "./harness/run-config.js";
import { createRunCommitPort } from "./harness/run-commit-port.js";
import { createHarnessRunEventObservers } from "./harness/run-event-observers.js";
import { createMoonTideStreamFn } from "./harness/stream-fn.js";
import { createMoonTideToolExecutor } from "./harness/tool-executor.js";

export interface AgentRunComposeOptions {
  resumeFromCheckpointId?: string;
  activeCompactionSaveId?: string;
  getCompactionPolicy: () => CompactionPolicy;
  onAfterCompose?: () => void;
}

export interface AgentRunExecuteOptions {
  extraRunEventListeners?: RunEventListener[];
}

export class AgentRun {
  private readonly session: Session;
  private readonly stores: SessionStores;
  private readonly loopCtx: LoopContext;
  private readonly composeOptions: AgentRunComposeOptions;

  constructor(
    session: Session,
    stores: SessionStores,
    loopCtx: LoopContext,
    composeOptions: AgentRunComposeOptions,
  ) {
    this.session = session;
    this.stores = stores;
    this.loopCtx = loopCtx;
    this.composeOptions = composeOptions;
  }

  async execute(
    userPrompt: string,
    options: AgentRunExecuteOptions = {},
  ): Promise<{ reply: string; turn: number }> {
    const { runtime } = this.loopCtx;

    return withRun(runtime, userPrompt, async () => {
      const runId = resetRun();
      const eventBus = createRunEventBus();
      const log = createMessageLog();
      const composeState = createComposeState();
      const deepModeState = createDeepModeRunState();

      const unsubCommit = eventBus.subscribe(createRunCommitPort({ session: this.session }));
      const unsubObservers = eventBus.subscribe(createHarnessRunEventObservers(runtime));
      const unsubDerive = eventBus.subscribe(createRunEventDeriveListener({ runId }));
      const extraUnsubs = (options.extraRunEventListeners ?? []).map((listener) =>
        eventBus.subscribe(listener),
      );

      try {
        const config = resolveRunConfig(
          createMoonTideRunConfig({
            session: this.session,
            stores: this.stores,
            loopCtx: this.loopCtx,
            composeOptions: this.composeOptions,
            composeState,
            deepModeState,
          }),
        );

        const result = await runLoop({
          eventBus,
          log,
          config,
          streamFn: createMoonTideStreamFn({ composeState, eventBus, runtime: this.loopCtx.runtime }),
          toolExecutor: createMoonTideToolExecutor({
            loopCtx: this.loopCtx,
            getTurn: () => composeState.turn,
          }),
          prompts: [{ role: "user", content: userPrompt, timestamp: Date.now() }],
        });

        return { reply: result.reply, turn: result.turns };
      } finally {
        unsubCommit();
        unsubObservers();
        unsubDerive();
        for (const unsub of extraUnsubs) {
          unsub();
        }
      }
    });
  }
}
