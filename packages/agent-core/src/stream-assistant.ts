import type {
  AssistantContent,
  AssistantMessage,
  StreamAssistantEvent,
  StreamFn,
  LlmContext,
} from "@moontide/agent-common";
import type { RunEventBus } from "./run-event-bus.js";
import { RunAbortError } from "./lifecycle.js";

function _emptyAssistant(): AssistantMessage {
  return { role: "assistant", content: [], timestamp: Date.now() };
}

function _appendText(content: AssistantContent[], text: string): AssistantContent[] {
  if (!text) {
    return content;
  }
  const last = content.at(-1);
  if (last?.type === "text") {
    return [...content.slice(0, -1), { type: "text", text: last.text + text }];
  }
  return [...content, { type: "text", text }];
}

function _mergeToolCall(
  content: AssistantContent[],
  toolCall: Extract<AssistantContent, { type: "toolCall" }>,
): AssistantContent[] {
  const index = content.findIndex(
    (block) => block.type === "toolCall" && block.toolCallId === toolCall.toolCallId,
  );
  if (index === -1) {
    return [...content, toolCall];
  }
  const next = [...content];
  next[index] = toolCall;
  return next;
}

export async function streamAssistantResponse(
  eventBus: RunEventBus,
  streamFn: StreamFn,
  context: LlmContext,
  signal?: AbortSignal,
): Promise<AssistantMessage> {
  let message = _emptyAssistant();
  eventBus.publish({ type: "message_start", message });

  const stream = await streamFn(context, signal);
  for await (const event of stream) {
    if (signal?.aborted) {
      throw new RunAbortError();
    }
    message = _applyStreamEvent(message, event);
    if (event.type === "text_delta" || event.type === "thinking_delta") {
      if (event.delta) {
        eventBus.publish({ type: "message_update", message, delta: event.delta });
      }
    }
    if (event.type === "error") {
      message = {
        ...message,
        content: _appendText(message.content, event.errorMessage ?? "Provider error"),
      };
      break;
    }
    if (event.type === "aborted") {
      throw new RunAbortError();
    }
    if (event.type === "done" && event.message?.role === "assistant") {
      message = event.message;
    }
  }

  eventBus.publish({ type: "message_end", message });
  return message;
}

function _applyStreamEvent(
  message: AssistantMessage,
  event: StreamAssistantEvent,
): AssistantMessage {
  switch (event.type) {
    case "text_delta":
      return {
        ...message,
        content: _appendText(message.content, event.delta?.kind === "text_delta" ? event.delta.text : ""),
      };
    case "thinking_delta":
      return message;
    case "tool_call":
      if (event.message?.role === "assistant") {
        return event.message;
      }
      if (event.delta?.kind === "tool_call_delta") {
        const block: AssistantContent = {
          type: "toolCall",
          toolCallId: event.delta.toolCallId,
          toolName: event.delta.toolName,
          args: _parseArgsJson(event.delta.argsJson),
        };
        return { ...message, content: _mergeToolCall(message.content, block) };
      }
      return message;
    case "done":
      return event.message?.role === "assistant" ? event.message : message;
    default:
      return message;
  }
}

function _parseArgsJson(argsJson: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(argsJson);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // partial JSON during stream
  }
  return {};
}

export function assistantHasToolCalls(message: AssistantMessage): boolean {
  return message.content.some((block) => block.type === "toolCall");
}

export function extractTextReply(message: AssistantMessage): string {
  return message.content
    .filter((block): block is Extract<AssistantContent, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("");
}
