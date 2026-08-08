import path from "node:path";

import { validationError } from "../errors/factories.js";
import { DATA_DIR } from "../constants/storage.js";

/** Cross-platform path join — single entry for future normalization rules. */
export function joinPath(...segments: string[]): string {
  return path.join(...segments);
}

/** Cross-platform path resolve — single entry for absolute paths. */
export function resolvePath(...segments: string[]): string {
  return path.resolve(...segments);
}

export function isAbsolutePath(filePath: string): boolean {
  return path.isAbsolute(filePath);
}

export function relativePath(from: string, to: string): string {
  return path.relative(from, to);
}

export function basename(filePath: string): string {
  return path.basename(filePath);
}

export function extname(filePath: string): string {
  return path.extname(filePath);
}

export function pathDelimiter(): string {
  return path.delimiter;
}

/** Workspace-local MoonTide data root: `<workdir>/.moontide`. */
export function dataDir(workdir: string): string {
  return joinPath(workdir, DATA_DIR);
}

/** Join segments under `<workdir>/.moontide` (runs, sessions, status.json, …). */
export function dataPath(workdir: string, ...segments: string[]): string {
  return joinPath(dataDir(workdir), ...segments);
}

/** Parent directory of a path. */
export function dirname(filePath: string): string {
  return path.dirname(filePath);
}

function resolveWorkspaceCandidate(filePath: string, workdir: string): string {
  return isAbsolutePath(filePath) ? resolvePath(filePath) : resolvePath(workdir, filePath);
}

/** True when `filePath` resolves outside `workdir` (absolute or relative). */
export function isOutsideWorkspace(filePath: string, workdir: string): boolean {
  if (!filePath) {
    return false;
  }
  const raw = resolveWorkspaceCandidate(filePath, workdir);
  const rel = relativePath(workdir, raw);
  return rel.startsWith("..") || isAbsolutePath(rel);
}

/** Alias for permission checks — same as {@link isOutsideWorkspace}. */
export function escapesWorkspace(filePath: string, workdir: string): boolean {
  return isOutsideWorkspace(filePath, workdir);
}

/** Resolve a workspace-relative path; throws if it escapes `workdir`. */
export function resolveWorkspacePath(relative: string, workdir: string): string {
  const resolved = resolvePath(workdir, relative);
  if (isOutsideWorkspace(resolved, workdir)) {
    throw validationError(`Path escapes workspace: ${relative}`, { context: { path: relative } });
  }
  return resolved;
}

export function shortenHomePath(dirPath: string, home = process.env.HOME): string {
  if (home && dirPath.startsWith(home)) {
    return `~${dirPath.slice(home.length)}`;
  }
  return dirPath;
}
