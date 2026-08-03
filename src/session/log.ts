import fs from "node:fs";

import { getWorkdir } from "../config.js";
import { appendNdjsonLine, ensureDirForFile } from "../storage/fs.js";
import { newEventId } from "../utils/id.js";
import { sessionLogPath } from "./paths.js";
import type { SessionLogReader, SessionLogReadOptions } from "./log-reader.js";
import type { SessionLog, SessionLogBody } from "./log-types.js";
import { isSessionLog } from "./log-types.js";
import type { SessionLogWriter } from "./log-writer.js";

function readLines(filePath: string): string[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .filter((line) => line.length > 0);
}

function parseLog(lines: string[]): SessionLog[] {
  const log: SessionLog[] = [];
  for (const line of lines) {
    const parsed: unknown = JSON.parse(line);
    if (isSessionLog(parsed)) {
      log.push(parsed);
    }
  }
  return log;
}

export function buildSessionLog(
  sessionId: string,
  turn: number,
  body: SessionLogBody,
): SessionLog {
  return {
    id: newEventId(),
    sessionId,
    turn,
    at: new Date().toISOString(),
    ...body,
  } as SessionLog;
}

export class FileSessionLogWriter implements SessionLogWriter {
  constructor(private readonly workdir = getWorkdir()) {}

  async append(sessionId: string, record: SessionLog): Promise<void> {
    const filePath = sessionLogPath(this.workdir, sessionId);
    ensureDirForFile(filePath);
    appendNdjsonLine(filePath, `${JSON.stringify(record)}\n`);
  }

  async appendBody(sessionId: string, turn: number, body: SessionLogBody): Promise<void> {
    await this.append(sessionId, buildSessionLog(sessionId, turn, body));
  }
}

export class FileSessionLogReader implements SessionLogReader {
  constructor(private readonly workdir = getWorkdir()) {}

  async readAll(sessionId: string): Promise<SessionLog[]> {
    return parseLog(readLines(sessionLogPath(this.workdir, sessionId)));
  }

  async readTail(options: SessionLogReadOptions): Promise<SessionLog[]> {
    const log = await this.readAll(options.sessionId);
    let start = 0;
    if (options.afterLogId) {
      const afterId = options.afterLogId;
      const index = log.findIndex((record) => record.id === afterId);
      start = index >= 0 ? index + 1 : 0;
    }
    const sliced = log.slice(start);
    if (options.limit !== undefined && options.limit >= 0) {
      return sliced.slice(-options.limit);
    }
    return sliced;
  }
}
