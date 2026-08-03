import type { SessionLog } from "./log-types.js";

export interface SessionLogReader {
  readAll(sessionId: string): Promise<SessionLog[]>;
}

export interface SessionLogReadOptions {
  sessionId: string;
  afterLogId?: string;
  limit?: number;
}

export interface SessionLogTailReader extends SessionLogReader {
  readTail(options: SessionLogReadOptions): Promise<SessionLog[]>;
}
