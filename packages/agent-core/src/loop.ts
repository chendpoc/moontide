import type {
  RunConfig,
  StreamFn,
  ToolExecutor,
  ToolResultMessage,
  TurnCompileResult,
  UserMessage,
} from "@moontide/agent-common";
import type { RunEventBus } from "./run-event-bus.js";
import type { MessageLog } from "./message-log.js";
import { appendToLog, withRun, withTurn } from "./lifecycle.js";
import { resolveTurnContext } from "./resolve-turn-context.js";
import {
  assistantHasToolCalls,
  extractTextReply,
  streamAssistantResponse,
} from "./stream-assistant.js";
import { executeToolCalls } from "./run-tools.js";

export interface RunLoopInput {
  eventBus: RunEventBus;
  log: MessageLog;
  config: Readonly<RunConfig>;
  streamFn: StreamFn;
  toolExecutor: ToolExecutor;
  /** Fallback when compileTurnContext omits system/tools. */
  llmDefaults?: Pick<TurnCompileResult, "system" | "tools">;
  prompts: UserMessage[];
  signal?: AbortSignal;
}

export interface RunLoopResult {
  reply: string;
  turns: number;
}

export async function runLoop(input: RunLoopInput): Promise<RunLoopResult> {
  const { eventBus, log, config, streamFn, toolExecutor, llmDefaults, prompts, signal } = input;

  return withRun({ eventBus, log }, async () => {
    for (const prompt of prompts) {
      appendToLog(eventBus, log, prompt);
    }

    let turns = 0;
    while (true) {
      turns += 1;
      let reply = "";

      const stop = await withTurn(eventBus, async (scope) => {
        const compiled = await resolveTurnContext(config, log.messages, turns, signal);
        const assistant = await streamAssistantResponse(
          eventBus,
          streamFn,
          {
            system: compiled.system ?? llmDefaults?.system,
            messages: [...compiled.messages],
            tools: compiled.tools ?? llmDefaults?.tools,
            attachment: compiled.attachment,
          },
          signal,
        );
        log.push(assistant);

        let toolResults: ToolResultMessage[] = [];
        if (assistantHasToolCalls(assistant)) {
          toolResults = await executeToolCalls(
            eventBus,
            log,
            config,
            assistant,
            toolExecutor,
            signal,
          );
        } else {
          reply = extractTextReply(assistant);
        }

        scope.finish(assistant, toolResults);

        const shouldStop = await config.shouldStopAfterTurn?.(
          {
            turnAssistantMessage: assistant,
            toolResults,
            messages: log.messages,
          },
          signal,
        );
        if (shouldStop === true) {
          return true;
        }
        if (shouldStop === false) {
          return false;
        }

        return !assistantHasToolCalls(assistant);
      });

      if (stop) {
        return { reply, turns };
      }
    }
  });
}
