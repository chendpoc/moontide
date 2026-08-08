import type { RunEvent } from "@moontide/agent-common";
import type { RunEventListener } from "@moontide/agent-core";
import { assistantMessageToContentBlocks } from "../agent/harness/message-map.js";
import { traceDraftsFromBlocks } from "@moontide/session/block-registry";
import { truncateOneLine } from "@moontide/shared/utils/text.js";
import { emit, finalizeRunOutputs, getRunId, resetRun } from "@moontide/log";
import type { EventDraft } from "@moontide/log";

export interface RunEventDeriveOptions {
  runId?: string;
}

/** Map RunEvent bus events to Agent Event Log drafts (M6). Replaces sessionItem derive. */
export function createRunEventDeriveListener(options: RunEventDeriveOptions = {}): RunEventListener {
  let turn = 0;

  return (event: RunEvent) => {
    if (event.type === "run_start") {
      resetRun(options.runId);
      turn = 0;
      return;
    }
    if (event.type === "turn_start") {
      turn += 1;
      return;
    }
    if (event.type === "message_end") {
      _deriveMessageEnd(event.message, turn);
      return;
    }
    if (event.type === "tool_execution_start") {
      _emitToolUse(event.toolCallId, event.toolName, event.args, turn);
      return;
    }
    if (event.type === "run_end" && event.outcome.kind === "success") {
      const reply = _extractReply(event.outcome.messages);
      if (reply) {
        emit({
          turn,
          phase: "stop",
          channel: "conversation",
          kind: "final",
          payload: { text: reply },
          preview: truncateOneLine(reply, 80),
        });
      }
      finalizeRunOutputs(getRunId());
    }
  };
}

function _deriveMessageEnd(
  message: Extract<RunEvent, { type: "message_end" }>["message"],
  turn: number,
): void {
  if (message.role === "user") {
    emit({
      turn,
      phase: "pre_llm",
      channel: "conversation",
      kind: "user_prompt",
      payload: { text: message.content },
      preview: truncateOneLine(message.content, 80),
    });
    return;
  }
  if (message.role === "assistant") {
    const blocks = assistantMessageToContentBlocks(message);
    for (const draft of traceDraftsFromBlocks(blocks, turn)) {
      emit(draft as EventDraft);
    }
    return;
  }
  if (message.role === "toolResult") {
    const body = message.isError ? `Error: ${message.content}` : message.content;
    emit({
      turn,
      phase: "post_tool",
      channel: "trace",
      kind: "tool_result",
      payload: {
        body,
        toolName: message.toolName,
        toolUseId: message.toolCallId,
        charCount: body.length,
      },
      preview: truncateOneLine(body),
    });
  }
}

function _emitToolUse(
  toolUseId: string,
  toolName: string,
  input: unknown,
  turn: number,
): void {
  const args = input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
  const body = JSON.stringify(args);
  emit({
    turn,
    phase: "post_llm",
    channel: "trace",
    kind: "tool_use",
    payload: {
      body,
      toolName,
      toolUseId,
      charCount: body.length,
      input: args,
    },
    preview: `${toolName}`.trim(),
  });
}

function _extractReply(messages: readonly { role: string; content?: unknown }[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant" || !Array.isArray(message.content)) {
      continue;
    }
    const text = message.content
      .filter((block): block is { type: "text"; text: string } =>
        typeof block === "object"
        && block !== null
        && "type" in block
        && block.type === "text"
        && "text" in block
        && typeof block.text === "string",
      )
      .map((block) => block.text)
      .join("");
    if (text) {
      return text;
    }
  }
  return "";
}
