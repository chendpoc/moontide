import { readLines as readFileLines } from "../../utils/fs.js";
import { newEventId } from "../../utils/id.js";
import type { SessionItem, SessionItemBody } from "../types.js";
import { isSessionItem } from "../types.js";

export function readLines(filePath: string): string[] {
  return readFileLines(filePath);
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
