import type {
  AssistantMessage,
  RunConfig,
  ToolCallContent,
  ToolExecutor,
  ToolResultMessage,
} from "@moontide/agent-common";
import type { RunEventBus } from "./run-event-bus.js";
import { appendToLog } from "./lifecycle.js";
import type { MessageLog } from "./message-log.js";

export async function executeToolCalls(
  eventBus: RunEventBus,
  log: MessageLog,
  config: Readonly<RunConfig>,
  assistantMessage: AssistantMessage,
  executor: ToolExecutor,
  signal?: AbortSignal,
): Promise<ToolResultMessage[]> {
  const toolCalls = assistantMessage.content.filter(
    (block): block is ToolCallContent => block.type === "toolCall",
  );
  const results: ToolResultMessage[] = [];

  for (const call of toolCalls) {
    if (call.argumentStatus === "malformed_tool_arguments") {
      const toolResult: ToolResultMessage = {
        role: "toolResult",
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        content: "Error: malformed tool arguments",
        isError: true,
        timestamp: Date.now(),
      };
      appendToLog(eventBus, log, toolResult);
      results.push(toolResult);
      continue;
    }

    const blocked = await config.beforeToolCall?.(
      {
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        args: call.args,
        assistantMessage,
      },
      signal,
    );
    if (blocked?.block) {
      const toolResult: ToolResultMessage = {
        role: "toolResult",
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        content: blocked.reason ?? "Tool call blocked",
        isError: true,
        timestamp: Date.now(),
      };
      _finalizeTool(eventBus, log, call, toolResult, true, toolResult);
      results.push(toolResult);
      continue;
    }

    eventBus.publish({
      type: "tool_execution_start",
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      args: call.args,
    });

    let executed;
    try {
      executed = await executor.execute(
        call.toolCallId,
        call.toolName,
        call.args,
        signal,
        (partial) => {
          eventBus.publish({
            type: "tool_execution_update",
            toolCallId: call.toolCallId,
            partialResult: partial,
          });
        },
      );
    } catch (error) {
      executed = {
        content: error instanceof Error ? error.message : String(error),
        isError: true,
      };
    }

    let content = executed.content;
    let isError = executed.isError ?? false;
    const override = await config.afterToolCall?.(
      {
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        args: call.args,
        result: executed,
        isError,
      },
      signal,
    );
    if (override?.content !== undefined) {
      content = override.content;
    }
    if (override?.isError !== undefined) {
      isError = override.isError;
    }

    const toolResult: ToolResultMessage = {
      role: "toolResult",
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      content,
      isError,
      timestamp: Date.now(),
    };
    _finalizeTool(eventBus, log, call, toolResult, isError, executed);
    results.push(toolResult);
  }

  return results;
}

function _finalizeTool(
  eventBus: RunEventBus,
  log: MessageLog,
  call: ToolCallContent,
  toolResult: ToolResultMessage,
  isError: boolean,
  result: unknown,
): void {
  eventBus.publish({
    type: "tool_execution_end",
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    result,
    isError,
  });
  appendToLog(eventBus, log, toolResult);
}
