/** Compaction record types. See docs/spec/context-composer.md §6.3. */

export interface SummaryPayload {
  text: string;
}

export interface StructuredPayload {
  goals: string[];
  decisions: string[];
  openQuestions: string[];
  fileAnchors: string[];
}

export interface CompactionRecord {
  id: string;
  sessionId: string;
  createdAtTurn: number;
  kind: "summary" | "structured";
  coversEntryIds: string[];
  payload: SummaryPayload | StructuredPayload;
}
