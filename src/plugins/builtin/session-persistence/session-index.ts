import { sessionIndexPath, sessionLogPath, sessionsDir } from "../../../session/paths.js";
import { ensureDirForFile, readJson, writeJsonPretty } from "../../../storage/fs.js";
import { exists, fileSize, listDir, readLines, stat } from "../../../utils/fs.js";
import type {
  SessionIndex,
  SessionIndexEntry,
  SessionListEntry,
  UpsertSessionMeta,
} from "./types.js";

function emptyIndex(): SessionIndex {
  return { entries: [] };
}

export function loadSessionIndex(workdir: string): SessionIndex {
  return readJson<SessionIndex>(sessionIndexPath(workdir)) ?? emptyIndex();
}

export function saveSessionIndex(workdir: string, index: SessionIndex): void {
  const path = sessionIndexPath(workdir);
  ensureDirForFile(path);
  writeJsonPretty(path, index);
}

function sessionLogHasContent(workdir: string, sessionId: string): boolean {
  const path = sessionLogPath(workdir, sessionId);
  return exists(path) && fileSize(path) > 0;
}

function countSessionLogLines(workdir: string, sessionId: string): number {
  return readLines(sessionLogPath(workdir, sessionId)).length;
}

export function upsertSessionEntry(
  workdir: string,
  sessionId: string,
  meta: UpsertSessionMeta,
): SessionIndexEntry {
  const index = loadSessionIndex(workdir);
  const existing = index.entries.find((entry) => entry.sessionId === sessionId);
  const entry: SessionIndexEntry = {
    sessionId,
    savedAt: new Date().toISOString(),
    messageCount: meta.messageCount,
    lastTurn: meta.lastTurn,
    ...(existing?.label ? { label: existing.label } : {}),
  };

  const without = index.entries.filter((item) => item.sessionId !== sessionId);
  without.push(entry);
  without.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  saveSessionIndex(workdir, { entries: without });
  return entry;
}

function listDiskSessions(workdir: string): SessionListEntry[] {
  const dir = sessionsDir(workdir);
  if (!exists(dir)) {
    return [];
  }

  const entries: SessionListEntry[] = [];
  for (const name of listDir(dir)) {
    if (!name.endsWith(".jsonl")) {
      continue;
    }
    const sessionId = name.slice(0, -".jsonl".length);
    if (!sessionLogHasContent(workdir, sessionId)) {
      continue;
    }
    entries.push({
      sessionId,
      messageCount: countSessionLogLines(workdir, sessionId),
      savedAt: stat(sessionLogPath(workdir, sessionId)).mtime.toISOString(),
      indexed: false,
    });
  }
  return entries;
}

export function listSessions(workdir: string): SessionListEntry[] {
  const indexed = loadSessionIndex(workdir).entries
    .filter((entry) => sessionLogHasContent(workdir, entry.sessionId))
    .map(
      (entry): SessionListEntry => ({
        sessionId: entry.sessionId,
        label: entry.label,
        messageCount: entry.messageCount,
        savedAt: entry.savedAt,
        indexed: true,
      }),
    );

  const indexedIds = new Set(indexed.map((entry) => entry.sessionId));
  const diskOnly = listDiskSessions(workdir).filter((entry) => !indexedIds.has(entry.sessionId));
  const merged = [...indexed, ...diskOnly];
  merged.sort((a, b) => (b.savedAt ?? "").localeCompare(a.savedAt ?? ""));
  return merged;
}

export function getLatestSessionEntry(workdir: string): SessionListEntry | undefined {
  const indexed = loadSessionIndex(workdir).entries
    .filter((entry) => entry.messageCount > 0 && sessionLogHasContent(workdir, entry.sessionId))
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));

  const latestIndexed = indexed[0];
  if (latestIndexed) {
    return {
      sessionId: latestIndexed.sessionId,
      label: latestIndexed.label,
      messageCount: latestIndexed.messageCount,
      savedAt: latestIndexed.savedAt,
      indexed: true,
    };
  }

  const disk = listDiskSessions(workdir).sort((a, b) =>
    (b.savedAt ?? "").localeCompare(a.savedAt ?? ""),
  );
  return disk[0];
}

export function sessionExists(workdir: string, sessionId: string): boolean {
  return sessionLogHasContent(workdir, sessionId);
}
