import {
  formatQuitHintLines,
  formatStartupHintLines,
  getActiveSessionMeta,
  getLatestSessionEntry,
  type SessionLifecycleAccess,
} from "@moontide/agent";
import { writeStderrLine } from "../terminal/write.js";

export function printStartupHint(workdir: string): void {
  const latest = getLatestSessionEntry(workdir);
  if (!latest) {
    return;
  }
  for (const line of formatStartupHintLines(latest)) {
    writeStderrLine(line);
  }
}

/** Print current session id and resume command before REPL exit (after auto-save). */
export function printQuitHint(access: SessionLifecycleAccess): void {
  const meta = getActiveSessionMeta(access);
  if (!meta) {
    return;
  }
  writeStderrLine("");
  for (const line of formatQuitHintLines(meta.sessionId, meta.messageCount, meta.label)) {
    writeStderrLine(line);
  }
}
