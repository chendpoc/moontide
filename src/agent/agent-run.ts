import type { Message } from "@anthropic-ai/sdk/resources/messages/messages.js";

import { composeContext } from "../context/composer/compose.js";
import type { CompactionPolicy } from "../context/composer/compaction/policy.js";
import type { ComposedLLMRequest } from "../context/composer/types.js";
import { publishComposeResult } from "../context/runtime-status.js";
import { hookDispatcher } from "./hooks/index.js";
import type { SessionStores } from "../context/stores/index.js";
import { extractText } from "../llm/client/anthropic.js";
import { resolveModelProfile } from "../llm/models/resolve.js";
import { getToolDefinitions } from "../tools/index.js";
import { mapSdkContentBlocks } from "../session/content-map.js";
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
    await hookDispatcher.dispatch("runStart", { userPrompt });
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
          await hookDispatcher.dispatch("runEnd", result);
          return result;
        }
      }
    } catch (error) {
      await hookDispatcher.dispatch("runError", { error });
      throw error;
    } finally {
      await hookDispatcher.dispatch("runFinalize", {});
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
      toolDefinitions: getToolDefinitions(),
      modelProfile: resolveModelProfile(),
      compactionPolicy: this.composeOptions.getCompactionPolicy(),
      resumeFromCheckpointId: this.composeOptions.resumeFromCheckpointId,
      activeCompactionSaveId: this.composeOptions.activeCompactionSaveId,
    });
    publishComposeResult(composed);
    await hookDispatcher.dispatch("composeComplete", { composed });
    this.composeOptions.onAfterCompose?.();
    return composed.request as ComposedLLMRequest;
  }

  private async callModel(runTurn: number, input: ComposedLLMRequest) {
    return runLLM({
      turn: runTurn,
      messages: input.messages,
      system: input.system,
      tools: input.tools,
    });
  }

  private async recordOutcome(
    runTurn: number,
    response: Message,
  ): Promise<{ reply: string } | undefined> {
    await this.session.appendAssistant(runTurn, mapSdkContentBlocks(response.content));

    if (response.stop_reason !== "tool_use") {
      return { reply: extractText(response.content) };
    }

    await runToolUses(runTurn, response.content, this.loopCtx);
    return undefined;
  }
}
