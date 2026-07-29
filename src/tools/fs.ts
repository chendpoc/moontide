import fs from "node:fs";
import path from "node:path";
import { globSync } from "glob";

import { getWorkdir } from "../config.js";

export function safePath(relative: string): string {
  const workdir = getWorkdir();
  const resolved = path.resolve(workdir, relative);
  const rel = path.relative(workdir, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path escapes workspace: ${relative}`);
  }
  return resolved;
}

export function runRead(filePath: string, limit?: number): string {
  try {
    const lines = fs.readFileSync(safePath(filePath), "utf8").split("\n");
    if (limit !== undefined && limit < lines.length) {
      return [...lines.slice(0, limit), `... (${lines.length - limit} more lines)`].join("\n");
    }
    return lines.join("\n");
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export function runWrite(filePath: string, content: string): string {
  try {
    const resolved = safePath(filePath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, content, "utf8");
    return `Wrote ${content.length} bytes to ${filePath}`;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export function runEdit(filePath: string, oldText: string, newText: string): string {
  try {
    const resolved = safePath(filePath);
    const text = fs.readFileSync(resolved, "utf8");
    if (!text.includes(oldText)) {
      return `Error: text not found in ${filePath}`;
    }
    const index = text.indexOf(oldText);
    const updated = text.slice(0, index) + newText + text.slice(index + oldText.length);
    fs.writeFileSync(resolved, updated, "utf8");
    return `Edited ${filePath}`;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export function runGlob(pattern: string): string {
  try {
    const workdir = getWorkdir();
    const matches = globSync(pattern, { cwd: workdir, nodir: true }).filter((match) => {
      const resolved = path.resolve(workdir, match);
      const rel = path.relative(workdir, resolved);
      return !rel.startsWith("..") && !path.isAbsolute(rel);
    });
    return matches.length > 0 ? matches.join("\n") : "(no matches)";
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}
