import type { ComposedContext } from "../../../context/composer/types.js";
import { emitDebugRecord } from "../../../context-inspect/debug-emit.js";
import type { LLMCallRecord, ToolUseRecord } from "../../../agent/pipeline/types.js";

export function handleDebugCompose({ composed }: { composed: ComposedContext }): void {
  emitDebugRecord({
    kind: "compose",
    turn: composed.manifest.turn,
    manifest: composed.manifest,
    request: composed.request,
  });
}

export function handleDebugLlmCall(record: LLMCallRecord): void {
  emitDebugRecord({
    kind: "llm_call",
    turn: record.turn,
    request: record.request,
    outcome: record.outcome,
  });
}

export function handleDebugToolUse(record: ToolUseRecord): void {
  emitDebugRecord({
    kind: "tool_use",
    turn: record.turn,
    toolName: record.toolName,
    toolUseId: record.toolUseId,
    toolInput: record.toolInput,
    outcome: record.outcome,
  });
}
