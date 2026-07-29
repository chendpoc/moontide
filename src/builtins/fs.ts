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

export function runRead(filePath: string, limit?: number, offset = 1): string {
  try {
    const lines = fs.readFileSync(safePath(filePath), "utf8").split("\n");
    const start = Math.max(0, Math.floor(offset) - 1);
    const end = limit !== undefined ? start + Math.max(0, Math.floor(limit)) : undefined;
    const slice = end !== undefined ? lines.slice(start, end) : lines.slice(start);
    const remaining = lines.length - (start + slice.length);
    if (limit !== undefined && remaining > 0) {
      return [...slice, `... (${remaining} more lines)`].join("\n");
    }
    return slice.join("\n");
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

const LIST_DIR_MAX_ENTRIES = 500;
const LIST_DIR_MAX_DEPTH = 2;

interface ListDirEntry {
  path: string;
  kind: "file" | "dir";
}

function listDirEntries(dirPath: string, prefix: string, depth: number, entries: ListDirEntry[]): void {
  if (entries.length >= LIST_DIR_MAX_ENTRIES || depth > LIST_DIR_MAX_DEPTH) {
    return;
  }

  let names: string[];
  try {
    names = fs.readdirSync(dirPath).sort();
  } catch {
    return;
  }

  for (const name of names) {
    if (entries.length >= LIST_DIR_MAX_ENTRIES) {
      break;
    }
    const absolute = path.join(dirPath, name);
    const relative = prefix ? `${prefix}/${name}` : name;
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(absolute);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) {
      continue;
    }
    if (stat.isDirectory()) {
      entries.push({ path: relative, kind: "dir" });
      listDirEntries(absolute, relative, depth + 1, entries);
    } else if (stat.isFile()) {
      entries.push({ path: relative, kind: "file" });
    }
  }
}

export function runListDir(relativePath = ".", recursive = false): string {
  try {
    const resolved = safePath(relativePath);
    if (!fs.existsSync(resolved)) {
      return `Error: path not found: ${relativePath}`;
    }
    const stat = fs.lstatSync(resolved);
    if (!stat.isDirectory()) {
      return `Error: not a directory: ${relativePath}`;
    }

    const entries: ListDirEntry[] = [];
    if (recursive) {
      listDirEntries(resolved, relativePath === "." ? "" : relativePath, 1, entries);
    } else {
      for (const name of fs.readdirSync(resolved).sort()) {
        const absolute = path.join(resolved, name);
        const itemStat = fs.lstatSync(absolute);
        if (itemStat.isSymbolicLink()) {
          continue;
        }
        entries.push({
          path: relativePath === "." ? name : `${relativePath}/${name}`,
          kind: itemStat.isDirectory() ? "dir" : "file",
        });
      }
    }

    if (entries.length === 0) {
      return "(empty)";
    }
    const truncated = entries.length >= LIST_DIR_MAX_ENTRIES;
    const lines = entries.map((entry) => `${entry.kind}\t${entry.path}`);
    return truncated ? [...lines, `... (truncated at ${LIST_DIR_MAX_ENTRIES} entries)`].join("\n") : lines.join("\n");
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}
