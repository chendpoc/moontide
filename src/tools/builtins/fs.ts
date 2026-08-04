import { getWorkdir } from "../../config.js";
import { globFiles } from "../../utils/glob.js";
import {
  exists,
  listDir,
  lstat,
  readText,
  writeText,
} from "../../utils/fs.js";
import {
  isAbsolutePath,
  joinPath,
  relativePath,
  resolvePath,
  resolveWorkspacePath,
} from "../../utils/path.js";

export function safePath(relative: string): string {
  return resolveWorkspacePath(relative);
}

export function runRead(filePath: string, limit?: number, offset = 1): string {
  try {
    const lines = readText(safePath(filePath)).split("\n");
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
    writeText(safePath(filePath), content);
    return `Wrote ${content.length} bytes to ${filePath}`;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export function runEdit(filePath: string, oldText: string, newText: string): string {
  try {
    const resolved = safePath(filePath);
    const text = readText(resolved);
    if (!text.includes(oldText)) {
      return `Error: text not found in ${filePath}`;
    }
    const index = text.indexOf(oldText);
    const updated = text.slice(0, index) + newText + text.slice(index + oldText.length);
    writeText(resolved, updated);
    return `Edited ${filePath}`;
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export function runGlob(pattern: string): string {
  try {
    const workdir = getWorkdir();
    const matches = globFiles(pattern, { cwd: workdir, nodir: true }).filter((match) => {
      const resolved = resolvePath(workdir, match);
      const rel = relativePath(workdir, resolved);
      return !rel.startsWith("..") && !isAbsolutePath(rel);
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
    names = listDir(dirPath).sort();
  } catch {
    return;
  }

  for (const name of names) {
    if (entries.length >= LIST_DIR_MAX_ENTRIES) {
      break;
    }
    const absolute = joinPath(dirPath, name);
    const relative = prefix ? `${prefix}/${name}` : name;
    let entryStat: ReturnType<typeof lstat>;
    try {
      entryStat = lstat(absolute);
    } catch {
      continue;
    }
    if (entryStat.isSymbolicLink()) {
      continue;
    }
    if (entryStat.isDirectory()) {
      entries.push({ path: relative, kind: "dir" });
      listDirEntries(absolute, relative, depth + 1, entries);
    } else if (entryStat.isFile()) {
      entries.push({ path: relative, kind: "file" });
    }
  }
}

export function runListDir(relativePath = ".", recursive = false): string {
  try {
    const resolved = safePath(relativePath);
    if (!exists(resolved)) {
      return `Error: path not found: ${relativePath}`;
    }
    const entryStat = lstat(resolved);
    if (!entryStat.isDirectory()) {
      return `Error: not a directory: ${relativePath}`;
    }

    const entries: ListDirEntry[] = [];
    if (recursive) {
      listDirEntries(resolved, relativePath === "." ? "" : relativePath, 1, entries);
    } else {
      for (const name of listDir(resolved).sort()) {
        const absolute = joinPath(resolved, name);
        const itemStat = lstat(absolute);
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
