import type { AgentPlugin, ToolUseRecord } from "../../agent/pipeline/types.js";
import type { EventDraft } from "../../events/types.js";

export function auditPlugin(): AgentPlugin {
  return {
    name: "audit",
    onToolUse(record: ToolUseRecord): EventDraft[] {
      return [
        {
          turn: record.turn,
          phase: "post_tool",
          channel: "audit",
          kind: "tool_use",
          payload: {
            toolName: record.toolName,
            toolInput: record.toolInput,
            status: record.outcome.status,
          },
          preview: record.toolName,
        },
      ];
    },
  };
}
