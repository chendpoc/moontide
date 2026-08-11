import type {
  RunConfig,
  StreamAssistantEvent,
  StreamFn,
  ToolExecutor,
} from "@moontide/run-protocol";

export function mockTextStreamFn(text: string): StreamFn {
  return async function* (): AsyncIterable<StreamAssistantEvent> {
    yield { type: "text_delta", delta: { kind: "text_delta", text } };
    yield {
      type: "done",
      message: {
        role: "assistant",
        content: [{ type: "text", text }],
        timestamp: Date.now(),
      },
    };
  };
}

export function mockTextAndToolStream(
  text: string,
  toolName: string,
  args: Record<string, unknown>,
): StreamFn {
  return async function* (): AsyncIterable<StreamAssistantEvent> {
    yield {
      type: "done",
      message: {
        role: "assistant",
        content: [
          { type: "text", text },
          {
            type: "toolCall",
            toolCallId: "call-1",
            toolName,
            args,
          },
        ],
        timestamp: Date.now(),
      },
    };
  };
}

export function mockToolThenTextStream(
  toolName: string,
  args: Record<string, unknown>,
  finalText: string,
): StreamFn {
  let call = 0;
  return async function* (_context, _signal): AsyncIterable<StreamAssistantEvent> {
    call += 1;
    if (call === 1) {
      yield {
        type: "done",
        message: {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              toolCallId: "call-1",
              toolName,
              args,
            },
          ],
          timestamp: Date.now(),
        },
      };
      return;
    }
    yield { type: "text_delta", delta: { kind: "text_delta", text: finalText } };
    yield {
      type: "done",
      message: {
        role: "assistant",
        content: [{ type: "text", text: finalText }],
        timestamp: Date.now(),
      },
    };
  };
}

export function noopToolExecutor(result = "ok"): ToolExecutor {
  return {
    async execute(_toolCallId, _toolName, _args) {
      return { content: result };
    },
  };
}

export function identityRunConfig(): RunConfig {
  return {
    convertToLlm: (messages) =>
      messages.map((message) => {
        if (message.role === "user") {
          return { role: "user" as const, content: message.content };
        }
        if (message.role === "toolResult") {
          return {
            role: "tool" as const,
            content: message.content,
            toolCallId: message.toolCallId,
          };
        }
        const text = message.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("");
        return { role: "assistant" as const, content: text };
      }),
  };
}

export { createRunEventBus } from "../run-event-bus.js";
