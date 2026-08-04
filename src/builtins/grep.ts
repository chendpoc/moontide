import { getWorkdir } from "../config.js";
import { clampInt } from "../utils/number.js";
import { spawnCollect } from "../utils/process.js";
import { basename, relativePath as workspaceRelativePath } from "../utils/path.js";
import { safePath } from "./fs.js";

export interface GrepInput {
  pattern: string;
  path?: string;
  glob?: string;
  max_results?: number;
  case_insensitive?: boolean;
}

export interface GrepMatch {
  file: string;
  line: number;
  column?: number;
  text: string;
}

export interface GrepResult {
  status: "ok" | "error";
  pattern?: string;
  matches?: GrepMatch[];
  truncated?: boolean;
  error?: string;
}

const DEFAULT_MAX_RESULTS = 50;
const MAX_RESULTS_CAP = 200;

export function normalizeGrepMaxResults(maxResults?: number): number {
  if (maxResults === undefined || !Number.isFinite(maxResults)) {
    return DEFAULT_MAX_RESULTS;
  }
  return clampInt(maxResults, 1, MAX_RESULTS_CAP);
}

function relativePath(absolutePath: string): string {
  const workdir = getWorkdir();
  return workspaceRelativePath(workdir, absolutePath) || basename(absolutePath);
}

interface RgMatchPayload {
  path?: { text?: string };
  lines?: { text?: string };
  line_number?: number;
  submatches?: Array<{ start?: number }>;
}

function parseRgJson(stdout: string, maxResults: number): { matches: GrepMatch[]; truncated: boolean } {
  const matches: GrepMatch[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    let parsed: { type?: string; data?: RgMatchPayload };
    try {
      parsed = JSON.parse(line) as { type?: string; data?: RgMatchPayload };
    } catch {
      continue;
    }
    if (parsed.type !== "match" || !parsed.data?.path?.text) {
      continue;
    }
    const data = parsed.data;
    const text = String(data.lines?.text ?? "").replace(/\n$/, "");
    matches.push({
      file: relativePath(data.path!.text!),
      line: Number(data.line_number ?? 0),
      column: data.submatches?.[0]?.start,
      text,
    });
    if (matches.length >= maxResults) {
      return { matches, truncated: true };
    }
  }
  return { matches, truncated: false };
}

function parseGrepPlain(stdout: string, maxResults: number): { matches: GrepMatch[]; truncated: boolean } {
  const matches: GrepMatch[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const match = line.match(/^([^:]+):(\d+):(.*)$/);
    if (!match) {
      continue;
    }
    matches.push({
      file: match[1]!,
      line: Number(match[2]),
      text: match[3]!,
    });
    if (matches.length >= maxResults) {
      return { matches, truncated: true };
    }
  }
  return { matches, truncated: false };
}

async function searchWithRg(
  pattern: string,
  searchPath: string,
  maxResults: number,
  glob: string | undefined,
  caseInsensitive: boolean,
): Promise<GrepResult> {
  const workdir = getWorkdir();
  const args = ["--json", "--max-count", String(maxResults), pattern, searchPath];
  if (glob) {
    args.splice(1, 0, "--glob", glob);
  }
  if (caseInsensitive) {
    args.splice(1, 0, "-i");
  }

  const { stdout, stderr, code } = await spawnCollect("rg", args, { cwd: workdir });
  if (code !== 0 && code !== 1) {
    return { status: "error", error: stderr.trim() || `rg exited with code ${String(code)}` };
  }
  const { matches, truncated } = parseRgJson(stdout, maxResults);
  return { status: "ok", pattern, matches, truncated };
}

async function searchWithGrep(
  pattern: string,
  searchPath: string,
  maxResults: number,
  caseInsensitive: boolean,
): Promise<GrepResult> {
  const workdir = getWorkdir();
  const args = ["-rn", pattern, searchPath];
  if (caseInsensitive) {
    args.unshift("-i");
  }
  const { stdout, stderr, code } = await spawnCollect("grep", args, { cwd: workdir });
  if (code !== 0 && code !== 1) {
    return { status: "error", error: stderr.trim() || `grep exited with code ${String(code)}` };
  }
  const { matches, truncated } = parseGrepPlain(stdout, maxResults);
  return { status: "ok", pattern, matches, truncated };
}

export async function runGrep(input: GrepInput): Promise<string> {
  const pattern = String(input.pattern ?? "").trim();
  if (!pattern) {
    return JSON.stringify({
      status: "error",
      error: "pattern is required",
    } satisfies GrepResult);
  }

  const maxResults = normalizeGrepMaxResults(input.max_results);
  const relative = String(input.path ?? ".").trim() || ".";
  let searchPath: string;
  try {
    searchPath = safePath(relative);
  } catch (error) {
    return JSON.stringify({
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    } satisfies GrepResult);
  }

  const caseInsensitive = input.case_insensitive === true;
  const glob = input.glob ? String(input.glob) : undefined;

  try {
    const rgResult = await searchWithRg(pattern, searchPath, maxResults, glob, caseInsensitive);
    if (rgResult.status === "ok") {
      return JSON.stringify(rgResult satisfies GrepResult);
    }

    const grepResult = await searchWithGrep(pattern, searchPath, maxResults, caseInsensitive);
    return JSON.stringify(grepResult satisfies GrepResult);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return JSON.stringify({
        status: "error",
        error: "Neither rg nor grep is available on PATH",
      } satisfies GrepResult);
    }
    return JSON.stringify({
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    } satisfies GrepResult);
  }
}
