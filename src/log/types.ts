export type AgentPhase = "pre_llm" | "post_llm" | "post_tool" | "stop";

export type AgentChannel = "conversation" | "trace" | "context" | "tool_use_log";

export type AgentKind =
  | "user_prompt"
  | "assistant_text"
  | "final"
  | "thinking"
  | "tool_use"
  | "tool_result"
  | "context_metrics"
  | "context_compact"
  | "plugin_error";

export interface AgentEvent {
  id: string;
  seq: number;
  runId: string;
  turn: number;
  phase: AgentPhase;
  channel: AgentChannel;
  kind: AgentKind;
  ts: number;
  payload: Record<string, unknown>;
  preview?: string;
}

/** Optional fields added for JSONL / NDJSON consumers (grep, log viewers). */
export interface EventLogMeta {
  summary?: string;
  displayHint?: AgentChannel;
}

export type EnrichedAgentEvent = AgentEvent & EventLogMeta;

/** Draft event before id/seq/runId/ts assignment. */
export type EventDraft = Omit<AgentEvent, "id" | "seq" | "runId" | "ts">;
