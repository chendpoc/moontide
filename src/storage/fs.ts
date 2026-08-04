import fs from "node:fs";

import { dirname } from "../utils/path.js";

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function ensureDirForFile(filePath: string): void {
  ensureDir(dirname(filePath));
}

export function appendNdjsonLine(filePath: string, line: string): void {
  fs.appendFileSync(filePath, line, "utf8");
}

export function appendNdjsonLines(filePath: string, lines: string): void {
  if (lines.length === 0) return;
  fs.appendFileSync(filePath, lines, "utf8");
}

export function writeNdjsonRecords(filePath: string, records: unknown[]): void {
  ensureDirForFile(filePath);
  const content =
    records.length > 0 ? `${records.map((record) => JSON.stringify(record)).join("\n")}\n` : "";
  fs.writeFileSync(filePath, content, "utf8");
}

export function writeJsonPretty(filePath: string, value: unknown): void {
  ensureDirForFile(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function readJson<T>(filePath: string): T | undefined {
  try {
    if (!fs.existsSync(filePath)) return undefined;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return undefined;
  }
}
