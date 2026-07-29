import { spawn } from "node:child_process";

import { getWorkdir } from "../config.js";
import { safePath } from "./fs.js";

const OUTPUT_LIMIT = 50_000;
const DEFAULT_LOG_N = 10;
const MAX_LOG_N = 50;
const DEFAULT_DIFF_LINES = 200;
const MAX_DIFF_LINES = 500;

export interface GitStatusResult {
  status: "ok" | "error";
  branch?: string;
  ahead?: number;
  behind?: number;
  staged_count?: number;
  unstaged_count?: number;
  untracked_count?: number;
  porcelain?: string;
  error?: string;
}

export interface GitDiffResult {
  status: "ok" | "error";
  summary?: string;
  truncated?: boolean;
  error?: string;
}

export interface GitLogCommit {
  hash: string;
  subject: string;
  date?: string;
}

export interface GitLogResult {
  status: "ok" | "error";
  commits?: GitLogCommit[];
  error?: string;
}

function spawnGit(args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd: getWorkdir() });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ stdout, stderr, code });
    });
  });
}

function isNotGitRepo(stderr: string): boolean {
  return /not a git repository/i.test(stderr);
}

function truncateText(text: string, limit = OUTPUT_LIMIT): { text: string; truncated: boolean } {
  if (text.length <= limit) {
    return { text, truncated: false };
  }
  return { text: text.slice(0, limit), truncated: true };
}

function parseStatusSb(firstLine: string): { branch?: string; ahead?: number; behind?: number } {
  const line = firstLine.replace(/^##\s*/, "").trim();
  const branch = line.split("...")[0]?.trim();
  const aheadMatch = line.match(/\[ahead (\d+)/);
  const behindMatch = line.match(/\[behind (\d+)/);
  return {
    branch: branch || undefined,
    ahead: aheadMatch ? Number(aheadMatch[1]) : undefined,
    behind: behindMatch ? Number(behindMatch[1]) : undefined,
  };
}

function countPorcelain(porcelain: string): {
  staged_count: number;
  unstaged_count: number;
  untracked_count: number;
} {
  let staged_count = 0;
  let unstaged_count = 0;
  let untracked_count = 0;

  for (const line of porcelain.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const x = line[0] ?? " ";
    const y = line[1] ?? " ";
    if (x === "?" && y === "?") {
      untracked_count += 1;
      continue;
    }
    if (x !== " " && x !== "?") {
      staged_count += 1;
    }
    if (y !== " " && y !== "?") {
      unstaged_count += 1;
    }
  }

  return { staged_count, unstaged_count, untracked_count };
}

export async function runGitStatus(): Promise<string> {
  try {
    const sb = await spawnGit(["status", "-sb"]);
    if (isNotGitRepo(sb.stderr)) {
      return JSON.stringify({ status: "error", error: "not a git repository" } satisfies GitStatusResult);
    }

    const porcelainOut = await spawnGit(["status", "--porcelain"]);
    const firstLine = sb.stdout.split("\n")[0]?.trim() ?? "";
    const parsed = parseStatusSb(firstLine);
    const counts = countPorcelain(porcelainOut.stdout);

    const result: GitStatusResult = {
      status: "ok",
      ...parsed,
      ...counts,
      porcelain: sb.stdout.trim(),
    };
    return JSON.stringify(result);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return JSON.stringify({ status: "error", error: "git is not available on PATH" } satisfies GitStatusResult);
    }
    return JSON.stringify({
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    } satisfies GitStatusResult);
  }
}

export interface GitDiffInput {
  stat?: boolean;
  path?: string;
  staged?: boolean;
  max_lines?: number;
}

export async function runGitDiff(input: GitDiffInput = {}): Promise<string> {
  const useStat = input.stat !== false;
  const staged = input.staged === true;
  const maxLines =
    input.max_lines !== undefined && Number.isFinite(Number(input.max_lines))
      ? Math.min(MAX_DIFF_LINES, Math.max(1, Math.floor(Number(input.max_lines))))
      : DEFAULT_DIFF_LINES;

  const args = ["diff"];
  if (staged) {
    args.push("--cached");
  }
  if (useStat) {
    args.push("--stat");
  }

  if (input.path !== undefined && String(input.path).trim()) {
    try {
      args.push("--", safePath(String(input.path)));
    } catch (error) {
      return JSON.stringify({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      } satisfies GitDiffResult);
    }
  }

  try {
    const { stdout, stderr, code } = await spawnGit(args);
    if (isNotGitRepo(stderr)) {
      return JSON.stringify({ status: "error", error: "not a git repository" } satisfies GitDiffResult);
    }
    if (code !== 0 && code !== 1) {
      return JSON.stringify({
        status: "error",
        error: (stderr || stdout).trim() || `git diff exited with code ${code}`,
      } satisfies GitDiffResult);
    }

    const raw = (stdout || "(no diff)").trim();
    let summary = raw;
    let truncated = false;
    if (!useStat && raw) {
      const lines = raw.split("\n");
      if (lines.length > maxLines) {
        summary = `${lines.slice(0, maxLines).join("\n")}\n... (truncated)`;
        truncated = true;
      }
    } else {
      const trimmed = truncateText(raw);
      summary = trimmed.text;
      truncated = trimmed.truncated;
    }

    return JSON.stringify({
      status: "ok",
      summary,
      ...(truncated ? { truncated: true } : {}),
    } satisfies GitDiffResult);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return JSON.stringify({ status: "error", error: "git is not available on PATH" } satisfies GitDiffResult);
    }
    return JSON.stringify({
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    } satisfies GitDiffResult);
  }
}

export interface GitLogInput {
  n?: number;
  path?: string;
  oneline?: boolean;
}

export async function runGitLog(input: GitLogInput = {}): Promise<string> {
  const n =
    input.n !== undefined && Number.isFinite(Number(input.n))
      ? Math.min(MAX_LOG_N, Math.max(1, Math.floor(Number(input.n))))
      : DEFAULT_LOG_N;
  const oneline = input.oneline !== false;

  const args = ["log", `-n`, String(n)];
  if (oneline) {
    args.push("--pretty=format:%H%x09%ad%x09%s", "--date=short");
  }

  if (input.path !== undefined && String(input.path).trim()) {
    try {
      args.push("--", safePath(String(input.path)));
    } catch (error) {
      return JSON.stringify({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      } satisfies GitLogResult);
    }
  }

  try {
    const { stdout, stderr, code } = await spawnGit(args);
    if (isNotGitRepo(stderr)) {
      return JSON.stringify({ status: "error", error: "not a git repository" } satisfies GitLogResult);
    }
    if (code !== 0) {
      return JSON.stringify({
        status: "error",
        error: (stderr || stdout).trim() || `git log exited with code ${code}`,
      } satisfies GitLogResult);
    }

    const commits: GitLogCommit[] = [];
    for (const line of stdout.split("\n")) {
      if (!line.trim()) {
        continue;
      }
      if (oneline) {
        const [hash, date, ...rest] = line.split("\t");
        if (hash) {
          commits.push({ hash, date: date || undefined, subject: rest.join("\t") || "" });
        }
      } else {
        commits.push({ hash: line.slice(0, 40), subject: line });
      }
    }

    return JSON.stringify({ status: "ok", commits } satisfies GitLogResult);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return JSON.stringify({ status: "error", error: "git is not available on PATH" } satisfies GitLogResult);
    }
    return JSON.stringify({
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    } satisfies GitLogResult);
  }
}

export interface GitSummaryLink {
  status: "use_code_repl";
  template: "git_summary";
  vars: { log_n: number };
  note: string;
}

export function runGitSummaryLink(logN?: number): string {
  const log_n =
    logN !== undefined && Number.isFinite(Number(logN))
      ? Math.max(1, Math.floor(Number(logN)))
      : 5;
  return JSON.stringify({
    status: "use_code_repl",
    template: "git_summary",
    vars: { log_n },
    note:
      "Combined status + log + diff --stat. Run via code_repl; implementation in templates/bodies/bash/git_summary.sh",
  } satisfies GitSummaryLink);
}
