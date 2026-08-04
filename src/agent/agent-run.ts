import { modelId } from "../config.js";
import { DEFAULT_MAX_TOKENS } from "../constants/llm.js";
import { composeContext } from "../context/composer/compose.js";
import type { CompactionPolicy } from "../context/composer/compaction/policy.js";
import type { ComposedLLMRequest } from "../context/composer/types.js";
import { publishComposeResult } from "./context-status.js";
import type { SessionStores } from "../session/stores/index.js";
import { extractText } from "../llm/normalize/extract-text.js";
import type { LLMResponse } from "../llm/protocol/types.js";
import { resolveModelProfile } from "../llm/models/resolve.js";
import { getToolDefinitions } from "../tools/index.js";
import type { Session } from "../session/session.js";
import type { LoopContext } from "./deps.js";
import { getWorkdir } from "../config.js";
import { resolveInstructionState } from "../instruction-state/index.js";
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
    const composed = await composeContext({
      sessionId: this.session.sessionId,
      turn: runTurn,
      messages: this.session.getMessages(),
      instructionState: resolveInstructionState(getWorkdir()),
      artifactStore: this.stores.artifacts,
      compactionStore: this.stores.compaction,
      checkpointStore: this.stores.checkpoints,
      toolDefinitions: getToolDefinitions(this.loopCtx.runtime),
      modelProfile: resolveModelProfile(),
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

    if (response.stopReason !== "tool_use") {
      return { reply: extractText(response.content) };
    }

    await runToolUses(runTurn, response.content, this.loopCtx);
    return undefined;
  }
}
