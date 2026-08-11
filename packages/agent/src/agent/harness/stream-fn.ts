import type { Message, ToolSchema } from "@moontide/llm/protocol";
import type { StreamFn, StreamAssistantEvent } from "@moontide/run-protocol";
import type { RunEventBus } from "@moontide/agent-core";
import { runLLM, isAbortError } from "@moontide/llm";
import { modelId } from "../../config.js";
import { DEFAULT_MAX_TOKENS } from "@moontide/shared/constants/llm.js";
import { isDeepModeEnabled } from "../deep-mode.js";
import { llmResponseToAssistantMessage } from "./message-map.js";
import { validateLlmStopReason } from "./stop-reason-policy.js";
import type { AgentRuntime } from "../runtime/index.js";
import type { ComposeState } from "./compose-state.js";

export interface MoonTideStreamFnOptions {
  composeState: ComposeState;
  eventBus: RunEventBus;
  runtime: AgentRuntime;
}

export interface MoonTideCompileAttachment {
  protocolMessages: Message[];
}

export function createMoonTideStreamFn(options: MoonTideStreamFnOptions): StreamFn {
  const { composeState, eventBus, runtime } = options;

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

    let response;
    try {
      response = await runLLM({
        turn: composeState.turn,
        deepMode: isDeepModeEnabled(),
        onLLMCall: async (record) => {
          await runtime.observers.dispatch("llmCall", record);
          eventBus.publish({ type: "llm_call_end", record });
        },
        model: modelId(),
        maxTokens: DEFAULT_MAX_TOKENS,
        messages: protocolMessages,
        system: context.system ?? "",
        tools: (context.tools ?? []) as ToolSchema[],
        signal,
      });
    } catch (err) {
      if (isAbortError(err) || signal?.aborted) {
        yield { type: "aborted" };
        return;
      }
      throw err;
    }

    const policy = validateLlmStopReason(response);
    if (!policy.ok) {
      yield { type: "error", errorMessage: policy.errorMessage };
      return;
    }

    const message = llmResponseToAssistantMessage(response.content);
    yield { type: "done", message };
  };
}
