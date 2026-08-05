import { ErrorCode } from "../../errors/codes.js";
import { reportError } from "../../errors/report.js";
import { toErrorRecord } from "../../errors/record.js";
import { toMessage, toStack } from "../../errors/normalize.js";
import type { HookFailureRecord, ToolUseContext } from "./types.js";
import { PHASE_DEFS, type HookPhase } from "./phases.js";
import type { LLMCallRecord, ToolUseRecord } from "../pipeline/types.js";

type HookErrorRecord = LLMCallRecord | ToolUseRecord | ToolUseContext;

export function logHookFailure(failure: HookFailureRecord): void {
  reportError(
    {
      code: ErrorCode.INTERNAL,
      message: failure.message,
      source: `hook:${failure.name}`,
      hook: failure.name,
      phase: failure.phase,
      turn: failure.turn,
      toolName: failure.toolName,
      toolUseId: failure.toolUseId,
      stack: failure.stack,
    },
    { event: false },
  );
}

export function emitHookError(
  phase: HookPhase,
  name: string,
  record: HookErrorRecord | undefined,
  err: unknown,
): void {
  const { errorChannel, errorPhase } = PHASE_DEFS[phase];
  const errorRecord = toErrorRecord(err, `hook:${name}`, {
    hook: name,
    phase,
    turn: record?.turn,
    toolName: record && "toolName" in record ? record.toolName : undefined,
    toolUseId: record && "toolUseId" in record ? record.toolUseId : undefined,
  });

  reportError(errorRecord, {
    route: {
      channel: errorChannel,
      phase: errorPhase,
      turn: record?.turn,
      hook: name,
      toolName: errorRecord.toolName,
      toolUseId: errorRecord.toolUseId,
    },
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
    message: toMessage(err),
    stack: toStack(err),
    turn: record?.turn,
    toolName: record && "toolName" in record ? record.toolName : undefined,
    toolUseId: record && "toolUseId" in record ? record.toolUseId : undefined,
  };
}
