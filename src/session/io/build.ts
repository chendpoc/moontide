import fs from "node:fs";

import { newEventId } from "../../utils/id.js";
import type { SessionItem, SessionItemBody } from "../types.js";
import { isSessionItem } from "../types.js";

export function readLines(filePath: string): string[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .filter((line) => line.length > 0);
}

export function parseItems(lines: string[]): SessionItem[] {
  const items: SessionItem[] = [];
  for (const line of lines) {
    const parsed: unknown = JSON.parse(line);
    if (isSessionItem(parsed)) {
      items.push(parsed);
    }
  }
  return items;
}

export function buildSessionItem(
  sessionId: string,
  turn: number,
  body: SessionItemBody,
): SessionItem {
  return {
    id: newEventId(),
    sessionId,
    turn,
    at: new Date().toISOString(),
    ...body,
  } as SessionItem;
}

/** @deprecated Use buildSessionItem */
export const buildSessionLog = buildSessionItem;
