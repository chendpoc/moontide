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

export function writeJsonPretty(filePath: string, value: unknown): void {
  ensureDirForFile(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
