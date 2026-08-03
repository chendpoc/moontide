import { newTimestampedId } from "../utils/id.js";

/** Filesystem-safe session id: YYYYMMDD-HHmmss-<8 hex> (same shape as runId). */
export function newSessionId(now = new Date()): string {
  return newTimestampedId(now);
}
