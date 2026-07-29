import path from "node:path";

import { getWorkdir } from "../config.js";

export function escapesWorkspace(filePath: string): boolean {
  const workdir = getWorkdir();
  const raw = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(workdir, filePath);
  const rel = path.relative(workdir, raw);
  return rel.startsWith("..") || path.isAbsolute(rel);
}
