import { resolvePath } from "./utils/path.js";

import type { DebugLevel } from "./constants/debug.js";
import {
  CODE_REPL_DEFAULT_RUNTIME,
  CODE_REPL_TIMEOUT_MS_DEFAULT,
  COMPACT_KEEP_TURNS_DEFAULT,
  COMPACT_THRESHOLD_DEFAULT,
  ARTIFACT_SPILL_THRESHOLD_BYTES_DEFAULT,
  CONTEXT_LIMITS,
  DEFAULT_MODEL,
  DEEPSEEK_ANTHROPIC_BASE_URL,
  ENV_PREFIX,
  OCULA_ENV,
  PROVIDER_ENV,
} from "./constants/index.js";

function env(name: string): string | undefined {
  return process.env[`${ENV_PREFIX}${name}`];
}

function envFlag(name: string): boolean {
  return env(name) === "1";
}

let workdir = resolvePath(env(OCULA_ENV.WORKDIR) ?? process.cwd());

export function getWorkdir(): string {
  return workdir;
}

export function setWorkdir(dir: string): void {
  workdir = resolvePath(dir);
}

export function apiKey(): string {
  const key =
    process.env[PROVIDER_ENV.ANTHROPIC_API_KEY]
    ?? process.env[PROVIDER_ENV.DEEPSEEK_API_KEY];
  if (!key) {
    throw new Error("Set DEEPSEEK_API_KEY (or ANTHROPIC_API_KEY) in .env");
  }
  return key;
}

export function baseUrl(): string {
  return process.env[PROVIDER_ENV.ANTHROPIC_BASE_URL] ?? DEEPSEEK_ANTHROPIC_BASE_URL;
}

export function modelId(): string {
  return process.env[PROVIDER_ENV.MODEL_ID] ?? DEFAULT_MODEL;
}

export function contextLimit(): number {
  const override = env(OCULA_ENV.CONTEXT_LIMIT);
  if (override) {
    const parsed = Number(override);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return CONTEXT_LIMITS[modelId()] ?? CONTEXT_LIMITS.default;
}

export function contextExact(): boolean {
  return envFlag(OCULA_ENV.CONTEXT_EXACT);
}

export function compactKeepTurns(): number {
  const n = Number(env(OCULA_ENV.COMPACT_KEEP_TURNS) ?? String(COMPACT_KEEP_TURNS_DEFAULT));
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : COMPACT_KEEP_TURNS_DEFAULT;
}

export function compactThreshold(): number {
  const n = Number(env(OCULA_ENV.COMPACT_THRESHOLD) ?? String(COMPACT_THRESHOLD_DEFAULT));
  return Number.isFinite(n) && n > 0 ? n : COMPACT_THRESHOLD_DEFAULT;
}

export function compactAutoDefault(): boolean {
  return envFlag(OCULA_ENV.COMPACT_AUTO);
}

export function artifactSpillThresholdBytes(): number {
  const n = Number(
    env(OCULA_ENV.ARTIFACT_SPILL_THRESHOLD_BYTES)
      ?? String(ARTIFACT_SPILL_THRESHOLD_BYTES_DEFAULT),
  );
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : ARTIFACT_SPILL_THRESHOLD_BYTES_DEFAULT;
}

export function codeReplDefaultRuntime(): string {
  return env(OCULA_ENV.CODE_REPL_DEFAULT_RUNTIME) ?? CODE_REPL_DEFAULT_RUNTIME;
}

export function codeReplTimeoutMs(): number {
  const n = Number(env(OCULA_ENV.CODE_REPL_TIMEOUT_MS) ?? String(CODE_REPL_TIMEOUT_MS_DEFAULT));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : CODE_REPL_TIMEOUT_MS_DEFAULT;
}

export function pythonPath(): string | undefined {
  return env(OCULA_ENV.PYTHON);
}

export function venvPath(): string | undefined {
  return env(OCULA_ENV.VENV);
}

export function codeReplDisabled(): boolean {
  return envFlag(OCULA_ENV.CODE_REPL_DISABLED);
}

export function deepResearchEnabled(): boolean {
  return envFlag(OCULA_ENV.DEEP_RESEARCH);
}

export function tavilyApiKey(): string | undefined {
  return env(OCULA_ENV.TAVILY_API_KEY) ?? process.env[PROVIDER_ENV.TAVILY_API_KEY];
}

export function thinkingModeDefault(): boolean {
  return envFlag(OCULA_ENV.THINKING);
}

export function verboseModeDefault(): boolean {
  return envFlag(OCULA_ENV.VERBOSE);
}

/** Default debug tier from OCULA_DEBUG: off | terminal (1/on) | file. */
export function debugModeDefault(): DebugLevel {
  const raw = env(OCULA_ENV.DEBUG)?.toLowerCase();
  if (!raw || raw === "0" || raw === "false" || raw === "off") {
    return "off";
  }
  if (raw === "file") {
    return "file";
  }
  return "terminal";
}

export function httpFetchEnabled(): boolean {
  const value = env(OCULA_ENV.HTTP);
  if (value === "0") {
    return false;
  }
  return true;
}
