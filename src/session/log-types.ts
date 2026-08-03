import type { ContentBlock } from "../llm/protocol/types.js";
import type { RoutingDecision } from "../llm/routing/types.js";

/** Shared fields on every session log record. See docs/spec/context-composer.md §5. */
export interface SessionLogBase {
  id: string;
  sessionId: string;
  turn: number;
  at: string;
}

export interface UserMessageLog extends SessionLogBase {
  kind: "user_message";
  text: string;
}

export interface AssistantMessageLog extends SessionLogBase {
  kind: "assistant_message";
  blocks: ContentBlock[];
}

export interface ToolInvocationLog extends SessionLogBase {
  kind: "tool_invocation";
  toolUseId: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultSummary {
  summary: string;
  byteCount: number;
  lineCount?: number;
  truncated?: boolean;
}

export interface ToolOutcomeLog extends SessionLogBase {
  kind: "tool_outcome";
  toolUseId: string;
  artifactId?: string;
  resultSummary: ToolResultSummary;
}

export type CompactionKind = "prune" | "tail_window" | "summary";

export interface CompactionEventLog extends SessionLogBase {
  kind: "compaction";
  compactionKind: CompactionKind;
  compactionRecordId?: string;
  excludedLogIds: string[];
  beforeTokens?: number;
  afterTokens?: number;
}

export interface CheckpointCreatedLog extends SessionLogBase {
  kind: "checkpoint_created";
  checkpointId: string;
}

export interface RoutingLog extends SessionLogBase {
  kind: "routing";
  decision: RoutingDecision;
}

export type SessionLog =
  | UserMessageLog
  | AssistantMessageLog
  | ToolInvocationLog
  | ToolOutcomeLog
  | CompactionEventLog
  | CheckpointCreatedLog
  | RoutingLog;

export type SessionLogKind = SessionLog["kind"];

/** Payload for append without base fields (id, sessionId, turn, at). */
export type SessionLogBody =
  | Omit<UserMessageLog, keyof SessionLogBase>
  | Omit<AssistantMessageLog, keyof SessionLogBase>
  | Omit<ToolInvocationLog, keyof SessionLogBase>
  | Omit<ToolOutcomeLog, keyof SessionLogBase>
  | Omit<CompactionEventLog, keyof SessionLogBase>
  | Omit<CheckpointCreatedLog, keyof SessionLogBase>
  | Omit<RoutingLog, keyof SessionLogBase>;

const SESSION_LOG_KINDS = new Set<SessionLogKind>([
  "user_message",
  "assistant_message",
  "tool_invocation",
  "tool_outcome",
  "compaction",
  "checkpoint_created",
  "routing",
]);

export function isSessionLog(value: unknown): value is SessionLog {
  if (!value || typeof value !== "object") {
    return false;
  }
  const kind = (value as { kind?: unknown }).kind;
  return typeof kind === "string" && SESSION_LOG_KINDS.has(kind as SessionLogKind);
}
