import type { ToolUseRecord } from "../../../agent/pipeline/types.js";
import type { EventDraft } from "@moontide/log";

export function buildToolUseLogDrafts(record: ToolUseRecord): EventDraft[] {
  return [
    {
      turn: record.turn,
      phase: "post_tool",
      channel: "tool_use_log",
      kind: "tool_use",
      payload: {
        toolName: record.toolName,
        toolInput: record.toolInput,
        status: record.outcome.status,
      },
      preview: record.toolName,
    },
  ];
}
