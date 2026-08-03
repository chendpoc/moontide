import type { Message } from "@anthropic-ai/sdk/resources/messages/messages.js";

import { composeContextV1 } from "../context/composer/compose.js";
import type { ComposedLLMRequest } from "../context/composer/types.js";
import { extractText } from "../llm/client/anthropic.js";
import { mapSdkContentBlocks } from "../session/content-map.js";
import { SessionLogSlice } from "../session/log-slice.js";
import type { Session } from "../session/session.js";
import type { LoopContext } from "./deps.js";
import { buildSystemPrompt } from "./prompt.js";
import { runLLM } from "./pipeline/runLLM.js";
import { runToolUses } from "./pipeline/runTool.js";
import { finalizeRunFromHooks, type RunHooks } from "./run-hooks.js";

export class AgentRun {
  private readonly session: Session;
  private readonly loopCtx: LoopContext;
  private readonly hooks: RunHooks;

  constructor(
    session: Session,
    loopCtx: LoopContext,
    hooks: RunHooks,
  ) {
    this.session = session;
    this.loopCtx = loopCtx;
    this.hooks = hooks;
  }

  async execute(userPrompt: string): Promise<{ reply: string; turn: number }> {
    this.hooks.onRunStart?.(userPrompt);
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
          this.hooks.onRunEnd?.(result);
          return result;
        }
      }
    } finally {
      finalizeRunFromHooks();
    }
  }

  private async recordUser(turn: number, prompt: string): Promise<void> {
    await this.session.appendUser(turn, prompt);
  }

  private async buildInput(runTurn: number): Promise<ComposedLLMRequest> {
    const system = buildSystemPrompt();
    const slice = await SessionLogSlice.fromSession(this.session);
    const messages = slice.toMessageParams();
    const composed = composeContextV1({ turn: runTurn, messages, system });
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
