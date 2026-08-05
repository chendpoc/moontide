import { readLines } from "../../../utils/fs.js";
import { workMemPath } from "../../../session/paths.js";
import { appendNdjsonLine, ensureDirForFile } from "../../../storage/fs.js";

import type { WorkMemEvent } from "./types.js";

export const WORK_MEM_ID_PATTERN = /^wm_[a-f0-9]{8,}$/;

export function ensureWorkMemFile(workdir: string, sessionId: string, workMemId: string): void {
  const path = workMemPath(workdir, sessionId, workMemId);
  ensureDirForFile(path);
}

export function appendWorkMemEvent(
  workdir: string,
  sessionId: string,
  workMemId: string,
  event: WorkMemEvent,
): void {
  const path = workMemPath(workdir, sessionId, workMemId);
  ensureDirForFile(path);
  appendNdjsonLine(path, `${JSON.stringify(event)}\n`);
}

export function readWorkMemEvents(
  workdir: string,
  sessionId: string,
  workMemId: string,
): WorkMemEvent[] {
  const path = workMemPath(workdir, sessionId, workMemId);
  const lines = readLines(path);
  const events: WorkMemEvent[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      events.push(JSON.parse(trimmed) as WorkMemEvent);
    } catch {
      // skip malformed lines
    }
  }
  return events;
}
