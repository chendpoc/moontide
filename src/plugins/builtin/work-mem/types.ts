export type WorkMemDraftKind = "outline" | "hypothesis" | "decision" | "action";

export type WorkMemPackTier = "normal" | "compact" | "emergency";

export type WorkMemBudgetTier = "normal" | "upgraded";

export type WorkMemEscalationStage =
  | "normal"
  | "refined_at_normal"
  | "cap_upgraded"
  | "emergency";

export type WorkMemEventKind =
  | "workmem_started"
  | "workmem_draft"
  | "workmem_note"
  | "workmem_summary"
  | "workmem_refine";

export interface WorkMemStartedEvent {
  kind: "workmem_started";
  workMemId: string;
  ts: string;
  goal: string;
}

export interface WorkMemDraftEvent {
  kind: "workmem_draft";
  entryId: string;
  ts: string;
  draftKind: WorkMemDraftKind;
  content: string;
}

export interface WorkMemNoteEvent {
  kind: "workmem_note";
  entryId: string;
  ts: string;
  content: string;
  ref?: string;
}

export interface WorkMemSummaryEvent {
  kind: "workmem_summary";
  ts: string;
  tier: "normal" | "emergency";
  charCount: number;
  text: string;
}

export interface WorkMemRefineEvent {
  kind: "workmem_refine";
  ts: string;
  tier: "compact";
  charCount: number;
  text: string;
}

export type WorkMemEvent =
  | WorkMemStartedEvent
  | WorkMemDraftEvent
  | WorkMemNoteEvent
  | WorkMemSummaryEvent
  | WorkMemRefineEvent;

export type WorkMemAction = "draft" | "note" | "summarize" | "refine";

export interface WorkMemHandlerInput {
  action: WorkMemAction;
  kind?: string;
  content?: string;
  ref?: string;
  max_chars?: number;
  tier?: string;
  reason?: string;
}

export interface WorkMemHandlerResult {
  status: "ok" | "error";
  workMemId?: string;
  active?: boolean;
  packTier?: WorkMemPackTier;
  text?: string;
  truncated?: boolean;
  error?: string;
}
