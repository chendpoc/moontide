import { emitDraft } from "../../log/event-hub.js";
import { getRunId } from "../../log/run.js";
import { writeStderrLine } from "../../terminal/write.js";
import type { HookFailureRecord, ToolUseContext } from "./types.js";
import { PHASE_DEFS, type HookPhase } from "./phases.js";
import type { LLMCallRecord, ToolUseRecord } from "../pipeline/types.js";

type HookErrorRecord = LLMCallRecord | ToolUseRecord | ToolUseContext;

export function logHookFailure(failure: HookFailureRecord): void {
  const location =
    failure.toolName !== undefined
      ? ` turn=${failure.turn ?? "?"} tool=${failure.toolName}`
      : failure.turn !== undefined
        ? ` turn=${failure.turn}`
        : "";
  writeStderrLine(
    `[hook:${failure.name}] ${failure.phase} failed:${location} ${failure.message}`,
  );
  if (failure.stack) {
    writeStderrLine(failure.stack);
  }
}

export function emitHookError(
  phase: HookPhase,
  name: string,
  record: HookErrorRecord | undefined,
  err: unknown,
): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  const { errorChannel, errorPhase } = PHASE_DEFS[phase];
  emitDraft({
    turn: record?.turn ?? 0,
    phase: errorPhase,
    channel: errorChannel,
    kind: "plugin_error",
    payload: {
      hook: name,
      phase,
      runId: getRunId(),
      toolName: record && "toolName" in record ? record.toolName : undefined,
      toolUseId: record && "toolUseId" in record ? record.toolUseId : undefined,
      message,
      stack,
    },
    preview: `${name}/${phase}`,
  });
}

export function toHookFailureRecord(
  phase: HookPhase,
  name: string,
  err: unknown,
  record?: HookErrorRecord,
): HookFailureRecord {
  return {
    phase,
    name,
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
    turn: record?.turn,
    toolName: record && "toolName" in record ? record.toolName : undefined,
    toolUseId: record && "toolUseId" in record ? record.toolUseId : undefined,
  };
}
