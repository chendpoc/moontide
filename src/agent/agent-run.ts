import { modelId } from "../config.js";
import { DEFAULT_MAX_TOKENS } from "../constants/llm.js";
import type { CompactionPolicy } from "../context/composer/compaction/policy.js";
import type { ComposedLLMRequest } from "../context/composer/types.js";
import type { SessionStores } from "../session/stores/index.js";
import { extractText } from "../llm/normalize/extract-text.js";
import type { LLMResponse } from "../llm/protocol/types.js";
import { getToolDefinitions } from "../tools/index.js";
import type { Session } from "../session/session.js";
import type { LoopContext } from "./deps.js";
import { composeForSession } from "./compose-for-turn.js";
import { patchLastManifestDeepTask, publishComposeResult } from "./context-status.js";
import {
  getActiveWorkMemId,
  isDeepModeEnabled,
} from "./deep-mode.js";
import {
  ORIENT_PROTOCOL_REMINDER_TEXT,
  SYNTHESIZE_PROTOCOL_REMINDER_TEXT,
  shouldSendOrientProtocolReminder,
} from "./deep-task-protocol.js";
import { getWorkMemAgentPorts } from "./ports/work-mem.js";
import { runLLM } from "./pipeline/runLLM.js";
import { runToolUses } from "./pipeline/runTool.js";

export interface AgentRunComposeOptions {
  resumeFromCheckpointId?: string;
  activeCompactionSaveId?: string;
  getCompactionPolicy: () => CompactionPolicy;
  onAfterCompose?: () => void;
}

export class AgentRun {
  private readonly session: Session;
  private readonly stores: SessionStores;
  private readonly loopCtx: LoopContext;
  private readonly composeOptions: AgentRunComposeOptions;
  private orientProtocolReminderSent = false;
  private synthesizeProtocolReminderSent = false;

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

  async execute(userPrompt: string): Promise<{ reply: string; turn: number }> {
    const { runtime } = this.loopCtx;
    await runtime.hooks.dispatch("runStart", { userPrompt });
    try {
      await this.recordUser(1, userPrompt);
      let runTurn = 0;
      while (true) {
        runTurn += 1;
        const input = await this.buildInput(runTurn);
        const response = await this.callModel(runTurn, input);
        const done = await this.recordOutcome(runTurn, response);
        if (done) {
          const result = { reply: done.reply, turn: runTurn };
          await runtime.hooks.dispatch("runEnd", result);
          return result;
        }
      }
    } catch (error) {
      await runtime.hooks.dispatch("runError", { error });
      throw error;
    } finally {
      await runtime.hooks.dispatch("runFinalize", {});
    }
  }

  private async recordUser(turn: number, prompt: string): Promise<void> {
    await this.session.appendUser(turn, prompt);
  }

  private async buildInput(runTurn: number): Promise<ComposedLLMRequest> {
    const composed = await composeForSession({
      session: this.session,
      stores: this.stores,
      turn: runTurn,
      toolDefinitions: getToolDefinitions(this.loopCtx.runtime.tools),
      compactionPolicy: this.composeOptions.getCompactionPolicy(),
      resumeFromCheckpointId: this.composeOptions.resumeFromCheckpointId,
      activeCompactionSaveId: this.composeOptions.activeCompactionSaveId,
    });
    publishComposeResult(composed);
    await this.loopCtx.runtime.hooks.dispatch("composeComplete", { composed });
    this.composeOptions.onAfterCompose?.();
    return composed.request as ComposedLLMRequest;
  }

  private async callModel(runTurn: number, input: ComposedLLMRequest) {
    return runLLM({
      turn: runTurn,
      runtime: this.loopCtx.runtime,
      model: modelId(),
      maxTokens: DEFAULT_MAX_TOKENS,
      messages: input.messages,
      system: input.system,
      tools: input.tools,
    });
  }

  private async recordOutcome(
    runTurn: number,
    response: LLMResponse,
  ): Promise<{ reply: string } | undefined> {
    await this.session.appendAssistant(runTurn, response.content);

    if (response.stopReason === "tool_use") {
      if (
        isDeepModeEnabled()
        && runTurn === 1
        && !this.orientProtocolReminderSent
        && shouldSendOrientProtocolReminder(response.content)
      ) {
        await runToolUses(runTurn, response.content, this.loopCtx);
        await this.session.appendProtocolReminder(runTurn, "orient", ORIENT_PROTOCOL_REMINDER_TEXT);
        this.orientProtocolReminderSent = true;
        return undefined;
      }

      await runToolUses(runTurn, response.content, this.loopCtx);
      return undefined;
    }

    if (isDeepModeEnabled() && !this.activeWorkMemHasDecision()) {
      if (!this.synthesizeProtocolReminderSent) {
        await this.session.appendProtocolReminder(
          runTurn,
          "synthesize",
          SYNTHESIZE_PROTOCOL_REMINDER_TEXT,
        );
        this.synthesizeProtocolReminderSent = true;
        return undefined;
      }
      patchLastManifestDeepTask({ synthesizeSkipped: true });
    }

    return { reply: extractText(response.content) };
  }

  private activeWorkMemHasDecision(): boolean {
    const workMemId = getActiveWorkMemId(this.session.sessionId);
    if (!workMemId) {
      return false;
    }
    return getWorkMemAgentPorts().hasDecisionDraft({
      sessionId: this.session.sessionId,
      workMemId,
    });
  }
}
