import type { SessionItem } from "../types.js";

export interface SessionItemReader {
  readAll(sessionId: string): Promise<SessionItem[]>;
}

export interface SessionItemReadOptions {
  sessionId: string;
  afterItemId?: string;
  limit?: number;
}

export interface SessionItemTailReader extends SessionItemReader {
  readTail(options: SessionItemReadOptions): Promise<SessionItem[]>;
}
