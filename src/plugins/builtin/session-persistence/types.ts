/** One bookmarked session in `.ocula/sessions/index.json`. */
export interface SessionIndexEntry {
  sessionId: string;
  label?: string;
  savedAt: string;
  messageCount: number;
  lastTurn: number;
}

export interface SessionIndex {
  entries: SessionIndexEntry[];
}

/** Listed session — indexed entry or disk-only jsonl. */
export interface SessionListEntry {
  sessionId: string;
  label?: string;
  messageCount: number;
  savedAt?: string;
  indexed: boolean;
}

export interface UpsertSessionMeta {
  messageCount: number;
  lastTurn: number;
}
