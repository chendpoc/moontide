import {
  appendText,
  readTextIfExists,
  writeText,
} from "../utils/fs.js";

export { ensureDir, ensureDirForFile } from "../utils/fs.js";

export function appendNdjsonLine(filePath: string, line: string): void {
  appendText(filePath, line);
}

export function appendNdjsonLines(filePath: string, lines: string): void {
  if (lines.length === 0) return;
  appendText(filePath, lines);
}

export function writeNdjsonRecords(filePath: string, records: unknown[]): void {
  const content =
    records.length > 0 ? `${records.map((record) => JSON.stringify(record)).join("\n")}\n` : "";
  writeText(filePath, content);
}

export function writeJsonPretty(filePath: string, value: unknown): void {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function readJson<T>(filePath: string): T | undefined {
  try {
    const raw = readTextIfExists(filePath);
    if (raw === undefined) return undefined;
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}
