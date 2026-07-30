import type { AgentPlugin, ToolUseRecord } from "../../agent/pipeline/types.js";
import { collectFromLLMCall, collectFromToolUse } from "./collector.js";

export function tracePlugin(): AgentPlugin {
  return {
    name: "trace",
    onLLMCall(record) {
      return collectFromLLMCall(record);
    },
    onToolUse(record: ToolUseRecord) {
      return collectFromToolUse(record);
    },
  };
}
