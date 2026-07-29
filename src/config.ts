import { config as loadEnv } from "dotenv";
import path from "node:path";

loadEnv({ override: true });

if (process.env.DEEPSEEK_API_KEY && !process.env.ANTHROPIC_API_KEY) {
  process.env.ANTHROPIC_API_KEY = process.env.DEEPSEEK_API_KEY;
}

if (process.env.DEEPSEEK_API_KEY && !process.env.ANTHROPIC_BASE_URL) {
  process.env.ANTHROPIC_BASE_URL = "https://api.deepseek.com/anthropic";
}

if (process.env.ANTHROPIC_BASE_URL) {
  delete process.env.ANTHROPIC_AUTH_TOKEN;
}

export const DEFAULT_MODEL = "deepseek-v4-pro";
export const DATA_DIR = ".oculeau";
export const AUDIT_LOG_PATH = ".oculeau-audit.log";

function env(name: string): string | undefined {
  return process.env[`OCULEAU_${name}`];
}

function envFlag(name: string): boolean {
  return env(name) === "1";
}

let workdir = path.resolve(env("WORKDIR") ?? process.cwd());

export function getWorkdir(): string {
  return workdir;
}

export function setWorkdir(dir: string): void {
  workdir = path.resolve(dir);
}

export function apiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY ?? process.env.DEEPSEEK_API_KEY;
  if (!key) {
    throw new Error("Set DEEPSEEK_API_KEY (or ANTHROPIC_API_KEY) in .env");
  }
  return key;
}

export function baseUrl(): string {
  return process.env.ANTHROPIC_BASE_URL ?? "https://api.deepseek.com/anthropic";
}

export function modelId(): string {
  return process.env.MODEL_ID ?? DEFAULT_MODEL;
}

const CONTEXT_LIMITS: Record<string, number> = {
  "deepseek-v4-pro": 128_000,
  "deepseek-v4-flash": 128_000,
  default: 128_000,
};

export function contextLimit(): number {
  const override = env("CONTEXT_LIMIT");
  if (override) {
    const parsed = Number(override);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return CONTEXT_LIMITS[modelId()] ?? CONTEXT_LIMITS.default;
}

export function contextVerbose(): 0 | 1 | 2 {
  const level = Number(env("CONTEXT_VERBOSE") ?? "0");
  if (level >= 2) {
    return 2;
  }
  if (level >= 1) {
    return 1;
  }
  return 0;
}

export function contextLogPath(): string {
  return env("CONTEXT_LOG") ?? `${DATA_DIR}/context.jsonl`;
}

export function contextExact(): boolean {
  return envFlag("CONTEXT_EXACT");
}

export function contextSnapshotEnabled(): boolean {
  return envFlag("CONTEXT_SNAPSHOT");
}

export function contextVerboseDetail(): boolean {
  return envFlag("CONTEXT_VERBOSE_DETAIL");
}

/** stderr context box display; independent of CONTEXT_VERBOSE detail level. */
export function contextDisplayEnabled(): boolean {
  return envFlag("CONTEXT_DISPLAY");
}

export function compactKeepTurns(): number {
  const n = Number(env("COMPACT_KEEP_TURNS") ?? "3");
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 3;
}

export function compactThreshold(): number {
  const n = Number(env("COMPACT_THRESHOLD") ?? "85");
  return Number.isFinite(n) && n > 0 ? n : 85;
}

export function compactAutoDefault(): boolean {
  return envFlag("COMPACT_AUTO");
}

export function eventsModeEnabled(): boolean {
  return envFlag("EVENTS");
}

export function eventsDisplayEnabled(): boolean {
  return envFlag("EVENTS_DISPLAY");
}

export function eventsLogPath(): string {
  return env("EVENTS_LOG") ?? `${DATA_DIR}/events.jsonl`;
}

export function traceEnabled(): boolean {
  return envFlag("TRACE");
}

export function codeReplDefaultRuntime(): string {
  return env("CODE_REPL_DEFAULT_RUNTIME") ?? "tsx";
}

export function codeReplTimeoutMs(): number {
  const n = Number(env("CODE_REPL_TIMEOUT_MS") ?? "120000");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 120_000;
}

export function pythonPath(): string | undefined {
  return env("PYTHON");
}

export function venvPath(): string | undefined {
  return env("VENV");
}

export function codeReplDisabled(): boolean {
  return envFlag("CODE_REPL_DISABLED");
}
