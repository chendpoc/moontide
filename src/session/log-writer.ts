import type { SessionLog } from "./log-types.js";

export interface SessionLogWriter {
  append(sessionId: string, record: SessionLog): Promise<void>;
  flush?(sessionId: string): Promise<void>;
}
