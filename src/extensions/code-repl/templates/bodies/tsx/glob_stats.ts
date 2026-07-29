import fs from "node:fs";
import path from "node:path";

/*__VARS__*/

const rootDir = __VARS__.dir as string;
const maxFiles = Math.max(1, Number(__VARS__.max_files ?? 5000));
const skipDirs = new Set([
  "node_modules",
  ".git",
  "dist",
  ".oculeau",
  "__pycache__",
  ".venv",
  "venv",
]);

const byExt: Record<string, { count: number; bytes: number }> = {};
let total = { count: 0, bytes: 0 };
let truncated = false;

function walk(dir: string): void {
  if (total.count >= maxFiles) {
    truncated = true;
    return;
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (total.count >= maxFiles) {
      truncated = true;
      return;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) {
        walk(full);
      }
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    let size = 0;
    try {
      size = fs.statSync(full).size;
    } catch {
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase() || "(no ext)";
    if (!byExt[ext]) {
      byExt[ext] = { count: 0, bytes: 0 };
    }
    byExt[ext]!.count += 1;
    byExt[ext]!.bytes += size;
    total.count += 1;
    total.bytes += size;
  }
}

walk(rootDir);

console.log(JSON.stringify({ dir: rootDir, by_ext: byExt, total, truncated }));
