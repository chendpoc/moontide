import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export interface SourceMatch {
  file: string;
  line: number;
  text: string;
}

export function collectTsFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(fullPath));
    } else if (entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

export function scanTsFiles(
  dir: string,
  linePattern: RegExp,
): SourceMatch[] {
  return collectTsFiles(dir).flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .map((text, index) => ({ file, line: index + 1, text: text.trim() }))
      .filter(({ text }) => linePattern.test(text)),
  );
}

export function repoPath(...segments: string[]): string {
  return path.resolve(import.meta.dirname, "../..", ...segments);
}
