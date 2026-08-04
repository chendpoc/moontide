import type { ContentBlock, Role } from "../llm/protocol/types.js";
import type { RoutingDecision } from "../llm/routing/types.js";

/** Shared fields on every persisted session item (jsonl line). */
export interface SessionItemBase {
  id: string;
  sessionId: string;
  turn: number;
  at: string;
}

export interface UserMessageItem extends SessionItemBase {
  kind: "user_message";
  text: string;
}

export interface AssistantMessageItem extends SessionItemBase {
  kind: "assistant_message";
  blocks: ContentBlock[];
}

export interface ToolInvocationItem extends SessionItemBase {
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

export interface ToolOutcomeItem extends SessionItemBase {
  kind: "tool_outcome";
  toolUseId: string;
  artifactId?: string;
  resultSummary: ToolResultSummary;
}

export type CompactionKind = "prune" | "tail_window" | "summary";

export interface CompactionItem extends SessionItemBase {
  kind: "compaction";
  compactionKind: CompactionKind;
  compactionRecordId?: string;
  excludedLogIds: string[];
  beforeTokens?: number;
  afterTokens?: number;
}

export interface CheckpointCreatedItem extends SessionItemBase {
  kind: "checkpoint_created";
  checkpointId: string;
}

export interface RoutingItem extends SessionItemBase {
  kind: "routing";
  decision: RoutingDecision;
}

/** Persistence DTO — one NDJSON line. Schema unchanged from legacy SessionLog. */
export type SessionItem =
  | UserMessageItem
  | AssistantMessageItem
  | ToolInvocationItem
  | ToolOutcomeItem
  | CompactionItem
  | CheckpointCreatedItem
  | RoutingItem;

export type SessionItemKind = SessionItem["kind"];

/** SessionItem kinds that are not hydrated into SessionContext.messages. */
export const NON_MESSAGE_ITEM_KINDS = [
  "compaction",
  "checkpoint_created",
  "routing",
] as const satisfies readonly SessionItemKind[];

export type NonMessageItemKind = (typeof NON_MESSAGE_ITEM_KINDS)[number];

/** Payload for append without base fields (id, sessionId, turn, at). */
export type SessionItemBody =
  | Omit<UserMessageItem, keyof SessionItemBase>
  | Omit<AssistantMessageItem, keyof SessionItemBase>
  | Omit<ToolInvocationItem, keyof SessionItemBase>
  | Omit<ToolOutcomeItem, keyof SessionItemBase>
  | Omit<CompactionItem, keyof SessionItemBase>
  | Omit<CheckpointCreatedItem, keyof SessionItemBase>
  | Omit<RoutingItem, keyof SessionItemBase>;

const SESSION_ITEM_KINDS = new Set<SessionItemKind>([
  "user_message",
  "assistant_message",
  "tool_invocation",
  "tool_outcome",
  "compaction",
  "checkpoint_created",
  "routing",
]);

export function isSessionItem(value: unknown): value is SessionItem {
  if (!value || typeof value !== "object") {
    return false;
  }
  const kind = (value as { kind?: unknown }).kind;
  return typeof kind === "string" && SESSION_ITEM_KINDS.has(kind as SessionItemKind);
}

export function isNonMessageSessionItem(item: SessionItem): item is Extract<
  SessionItem,
  { kind: NonMessageItemKind }
> {
  return (NON_MESSAGE_ITEM_KINDS as readonly string[]).includes(item.kind);
}

/** In-memory conversation entry (domain). */
export interface SessionMessage {
  id: string;
  sessionId: string;
  turn: number;
  at: string;
  role: Role;
  content: string | ContentBlock[];
}

/** Read-only in-memory session state. Mutations go through Session.append*. */
export interface SessionContext {
  readonly messages: readonly SessionMessage[];
}

/** @deprecated Use SessionItem */
export type SessionLog = SessionItem;
/** @deprecated Use SessionItemBase */
export type SessionLogBase = SessionItemBase;
/** @deprecated Use SessionItemBody */
export type SessionLogBody = SessionItemBody;
/** @deprecated Use SessionItemKind */
export type SessionLogKind = SessionItemKind;
/** @deprecated Use UserMessageItem */
export type UserMessageLog = UserMessageItem;
/** @deprecated Use AssistantMessageItem */
export type AssistantMessageLog = AssistantMessageItem;
/** @deprecated Use ToolInvocationItem */
export type ToolInvocationLog = ToolInvocationItem;
/** @deprecated Use ToolOutcomeItem */
export type ToolOutcomeLog = ToolOutcomeItem;
/** @deprecated Use CompactionItem */
export type CompactionEventLog = CompactionItem;
/** @deprecated Use CheckpointCreatedItem */
export type CheckpointCreatedLog = CheckpointCreatedItem;
/** @deprecated Use RoutingItem */
export type RoutingLog = RoutingItem;

/** @deprecated Use isSessionItem */
export const isSessionLog = isSessionItem;
