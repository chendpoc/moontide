import type { SessionItem } from "../types.js";

export interface SessionItemWriter {
  append(sessionId: string, item: SessionItem): Promise<void>;
  appendMany(sessionId: string, items: SessionItem[]): Promise<void>;
  replaceAll(sessionId: string, items: SessionItem[]): Promise<void>;
  flush?(sessionId: string): Promise<void>;
}

/** @deprecated Use SessionItemWriter */
export type SessionLogWriter = SessionItemWriter;
