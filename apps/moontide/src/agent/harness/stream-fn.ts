import type { Message, ToolSchema } from "@moontide/llm/protocol";
import type { StreamFn, StreamAssistantEvent } from "@moontide/agent-common";
import { runLLM } from "@moontide/llm";
import { modelId } from "../../config.js";
import { DEFAULT_MAX_TOKENS } from "@moontide/shared/constants/llm.js";
import type { AgentRuntime } from "../runtime/index.js";
import { isDeepModeEnabled } from "../deep-mode.js";
import { llmResponseToAssistantMessage } from "./message-map.js";
import type { ComposeState } from "./compose-state.js";

export interface MoonTideStreamFnOptions {
  runtime: AgentRuntime;
  composeState: ComposeState;
}

export interface MoonTideCompileAttachment {
  protocolMessages: Message[];
}

export function createMoonTideStreamFn(options: MoonTideStreamFnOptions): StreamFn {
  const { runtime, composeState } = options;

  return async function* streamFn(context, signal): AsyncIterable<StreamAssistantEvent> {
    const attachment = context.attachment as MoonTideCompileAttachment | undefined;
    const protocolMessages = attachment?.protocolMessages;
    if (!protocolMessages) {
      yield { type: "error", errorMessage: "Compile attachment missing protocol messages" };
      return;
    }

    if (signal?.aborted) {
      yield { type: "aborted" };
      return;
    }

    const response = await runLLM({
      turn: composeState.turn,
      deepMode: isDeepModeEnabled(),
      onLLMCall: (record) => runtime.hooks.dispatch("llmCall", record),
      model: modelId(),
      maxTokens: DEFAULT_MAX_TOKENS,
      messages: protocolMessages,
      system: context.system ?? "",
      tools: (context.tools ?? []) as ToolSchema[],
    });
    const message = llmResponseToAssistantMessage(response.content);
    yield { type: "done", message };
  };
}
