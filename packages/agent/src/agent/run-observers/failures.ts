import { ErrorCode } from "@moontide/shared/errors/codes.js";
import { publishAgentError } from "../event-outputs.js";
import { toErrorRecord } from "@moontide/shared/errors/record.js";
import { toMessage, toStack } from "@moontide/shared/errors/normalize.js";
import type { ObserverFailureRecord, ToolUseContext } from "./types.js";
import { PHASE_DEFS, type ObserverPhase } from "./phases.js";
import type { LLMCallRecord, ToolUseRecord } from "../pipeline/types.js";

type HookErrorRecord = LLMCallRecord | ToolUseRecord | ToolUseContext;

export function logObserverFailure(failure: ObserverFailureRecord): void {
  publishAgentError(
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

export function emitObserverError(
  phase: ObserverPhase,
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

  publishAgentError(errorRecord, {
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

export function toObserverFailureRecord(
  phase: ObserverPhase,
  name: string,
  err: unknown,
  record?: HookErrorRecord,
): ObserverFailureRecord {
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
