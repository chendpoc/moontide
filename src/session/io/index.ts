import { getWorkdir } from "../../config.js";
import {
  appendNdjsonLines,
  ensureDirForFile,
  writeNdjsonRecords,
} from "../../storage/fs.js";
import { sessionLogPath } from "../paths.js";
import type { SessionItem, SessionItemBody } from "../types.js";
import { buildSessionItem } from "./build.js";
import type { SessionItemReadOptions, SessionItemTailReader } from "./reader.js";
import { parseItems, readLines } from "./build.js";
import type { SessionItemWriter } from "./writer.js";

export class FileSessionItemWriter implements SessionItemWriter {
  constructor(private readonly workdir = getWorkdir()) {}

  async append(sessionId: string, item: SessionItem): Promise<void> {
    await this.appendMany(sessionId, [item]);
  }

  async appendMany(sessionId: string, items: SessionItem[]): Promise<void> {
    if (items.length === 0) return;
    const filePath = sessionLogPath(this.workdir, sessionId);
    ensureDirForFile(filePath);
    appendNdjsonLines(
      filePath,
      items.map((item) => `${JSON.stringify(item)}\n`).join(""),
    );
  }

  async replaceAll(sessionId: string, items: SessionItem[]): Promise<void> {
    writeNdjsonRecords(sessionLogPath(this.workdir, sessionId), items);
  }

  async appendBody(sessionId: string, turn: number, body: SessionItemBody): Promise<void> {
    await this.append(sessionId, buildSessionItem(sessionId, turn, body));
  }
}

export async function replaceSessionItems(
  sessionId: string,
  items: SessionItem[],
  workdir = getWorkdir(),
): Promise<void> {
  await new FileSessionItemWriter(workdir).replaceAll(sessionId, items);
}

export class FileSessionItemReader implements SessionItemTailReader {
  constructor(private readonly workdir = getWorkdir()) {}

  async readAll(sessionId: string): Promise<SessionItem[]> {
    return parseItems(readLines(sessionLogPath(this.workdir, sessionId)));
  }

  async readTail(options: SessionItemReadOptions): Promise<SessionItem[]> {
    const items = await this.readAll(options.sessionId);
    let start = 0;
    if (options.afterItemId) {
      const index = items.findIndex((item) => item.id === options.afterItemId);
      start = index >= 0 ? index + 1 : 0;
    }
    const sliced = items.slice(start);
    if (options.limit !== undefined && options.limit >= 0) {
      return sliced.slice(-options.limit);
    }
    return sliced;
  }
}

export { buildSessionItem, parseItems, readLines } from "./build.js";
