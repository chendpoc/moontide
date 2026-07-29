export type AgentPhase = "pre_llm" | "post_llm" | "post_tool" | "stop";

export type AgentChannel = "conversation" | "trace" | "context" | "audit";

export type AgentKind =
  | "user_prompt"
  | "assistant_text"
  | "final"
  | "thinking"
  | "tool_use"
  | "tool_result"
  | "metrics_pre"
  | "metrics_post";

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

export type PartialAgentEvent = EventDraft;

export type PhaseSlot =
  | "pre_llm:context"
  | "post_llm:trace"
  | "post_llm:context"
  | "post_tool:trace";
