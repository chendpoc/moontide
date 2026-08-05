import { configError } from "./errors/factories.js";
import { resolvePath } from "./utils/path.js";

import type { DebugLevel } from "./constants/debug.js";
import {
  CODE_REPL_DEFAULT_RUNTIME,
  CODE_REPL_TIMEOUT_MS_DEFAULT,
  COMPACT_KEEP_TURNS_DEFAULT,
  COMPACT_THRESHOLD_DEFAULT,
  ARTIFACT_SPILL_THRESHOLD_BYTES_DEFAULT,
  ARTIFACT_SPILL_PREVIEW_RATIO,
  TRACE_PREVIEW_CHARS_DEFAULT,
  CONTEXT_LIMITS,
  DEFAULT_MODEL,
  DEEPSEEK_ANTHROPIC_BASE_URL,
  ENV_PREFIX,
  APP_ENV,
  PROVIDER_ENV,
} from "./constants/index.js";

function env(name: string): string | undefined {
  return process.env[`${ENV_PREFIX}${name}`];
}

function envFlag(name: string): boolean {
  return env(name) === "1";
}

/** Explicit tri-state env flag: true / false / unset (invalid values → unset). */
function envFlagOptional(name: string): boolean | undefined {
  const raw = env(name);
  if (raw === undefined || raw === "") {
    return undefined;
  }
  const v = raw.toLowerCase();
  if (v === "1" || v === "true" || v === "on") {
    return true;
  }
  if (v === "0" || v === "false" || v === "off") {
    return false;
  }
  return undefined;
}

export type AppEnvProfile = "dev" | "production";

/** Runtime profile from app env key; unset or unknown values default to production. */
export function appEnv(): AppEnvProfile {
  const raw = env(APP_ENV.ENV)?.toLowerCase();
  if (raw === "dev" || raw === "development") {
    return "dev";
  }
  if (raw === "prod" || raw === "production") {
    return "production";
  }
  return "production";
}

export function isDevEnv(): boolean {
  return appEnv() === "dev";
}

let workdir = resolvePath(env(APP_ENV.WORKDIR) ?? process.cwd());

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
    throw configError("Set DEEPSEEK_API_KEY (or ANTHROPIC_API_KEY) in .env");
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
  const override = env(APP_ENV.CONTEXT_LIMIT);
  if (override) {
    const parsed = Number(override);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return CONTEXT_LIMITS[modelId()] ?? CONTEXT_LIMITS.default;
}

export function contextExact(): boolean {
  return envFlag(APP_ENV.CONTEXT_EXACT);
}

export function compactKeepTurns(): number {
  const n = Number(env(APP_ENV.COMPACT_KEEP_TURNS) ?? String(COMPACT_KEEP_TURNS_DEFAULT));
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : COMPACT_KEEP_TURNS_DEFAULT;
}

export function compactThreshold(): number {
  const n = Number(env(APP_ENV.COMPACT_THRESHOLD) ?? String(COMPACT_THRESHOLD_DEFAULT));
  return Number.isFinite(n) && n > 0 ? n : COMPACT_THRESHOLD_DEFAULT;
}

export function compactAutoDefault(): boolean {
  return envFlag(APP_ENV.COMPACT_AUTO);
}

export function artifactSpillThresholdBytes(): number {
  const n = Number(
    env(APP_ENV.ARTIFACT_SPILL_THRESHOLD_BYTES)
      ?? String(ARTIFACT_SPILL_THRESHOLD_BYTES_DEFAULT),
  );
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : ARTIFACT_SPILL_THRESHOLD_BYTES_DEFAULT;
}

/** Preview length for spilled tool outputs (default: 20% of spill threshold; override via env). */
export function toolPreviewChars(): number {
  const raw = env(APP_ENV.TOOL_PREVIEW_CHARS);
  if (raw !== undefined && raw !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) {
      return Math.floor(n);
    }
  }
  return Math.floor(artifactSpillThresholdBytes() * ARTIFACT_SPILL_PREVIEW_RATIO);
}

export function codeReplDefaultRuntime(): string {
  return env(APP_ENV.CODE_REPL_DEFAULT_RUNTIME) ?? CODE_REPL_DEFAULT_RUNTIME;
}

export function codeReplTimeoutMs(): number {
  const n = Number(env(APP_ENV.CODE_REPL_TIMEOUT_MS) ?? String(CODE_REPL_TIMEOUT_MS_DEFAULT));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : CODE_REPL_TIMEOUT_MS_DEFAULT;
}

export function pythonPath(): string | undefined {
  return env(APP_ENV.PYTHON);
}

export function venvPath(): string | undefined {
  return env(APP_ENV.VENV);
}

export function codeReplDisabled(): boolean {
  return envFlag(APP_ENV.CODE_REPL_DISABLED);
}

export function deepResearchEnabled(): boolean {
  return envFlag(APP_ENV.DEEP_RESEARCH);
}

export function tavilyApiKey(): string | undefined {
  return env(APP_ENV.TAVILY_API_KEY) ?? process.env[PROVIDER_ENV.TAVILY_API_KEY];
}

export function thinkingModeDefault(): boolean {
  return envFlag(APP_ENV.THINKING);
}

export function verboseModeDefault(): boolean {
  return envFlag(APP_ENV.VERBOSE);
}

/** Thinking/trace one-line preview length on stderr (default 120). */
export function tracePreviewChars(): number {
  const n = Number(env(APP_ENV.TRACE_PREVIEW_CHARS) ?? String(TRACE_PREVIEW_CHARS_DEFAULT));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : TRACE_PREVIEW_CHARS_DEFAULT;
}

/** UI copy locale: `en` (default) or `zh` (via LANG env var). */
export function localeDefault(): "en" | "zh" {
  const raw = env(APP_ENV.LANG)?.toLowerCase();
  if (raw === "zh" || raw === "zh-cn" || raw === "zh_cn") {
    return "zh";
  }
  return "en";
}

/** Default debug tier from DEBUG env: off | terminal (1/on) | file. */
export function debugModeDefault(): DebugLevel {
  const raw = env(APP_ENV.DEBUG)?.toLowerCase();
  if (!raw || raw === "0" || raw === "false" || raw === "off") {
    return "off";
  }
  if (raw === "file") {
    return "file";
  }
  return "terminal";
}

export function httpFetchEnabled(): boolean {
  const value = env(APP_ENV.HTTP);
  if (value === "0") {
    return false;
  }
  return true;
}

export function alwaysAllowDefault(): boolean {
  const explicit = envFlagOptional(APP_ENV.ALWAYS_ALLOW);
  if (explicit !== undefined) {
    return explicit;
  }
  return isDevEnv();
}
