import path from "node:path";

import {
  CODE_REPL_DEFAULT_RUNTIME,
  CODE_REPL_TIMEOUT_MS_DEFAULT,
  COMPACT_KEEP_TURNS_DEFAULT,
  COMPACT_THRESHOLD_DEFAULT,
  CONTEXT_LIMITS,
  DEFAULT_MODEL,
  DEEPSEEK_ANTHROPIC_BASE_URL,
  ENV_PREFIX,
  OCULEAU_ENV,
  PROVIDER_ENV,
} from "./constants/index.js";

function env(name: string): string | undefined {
  return process.env[`${ENV_PREFIX}${name}`];
}

function envFlag(name: string): boolean {
  return env(name) === "1";
}

let workdir = path.resolve(env(OCULEAU_ENV.WORKDIR) ?? process.cwd());

export function getWorkdir(): string {
  return workdir;
}

export function setWorkdir(dir: string): void {
  workdir = path.resolve(dir);
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
  const override = env(OCULEAU_ENV.CONTEXT_LIMIT);
  if (override) {
    const parsed = Number(override);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return CONTEXT_LIMITS[modelId()] ?? CONTEXT_LIMITS.default;
}

export function contextExact(): boolean {
  return envFlag(OCULEAU_ENV.CONTEXT_EXACT);
}

export function compactKeepTurns(): number {
  const n = Number(env(OCULEAU_ENV.COMPACT_KEEP_TURNS) ?? String(COMPACT_KEEP_TURNS_DEFAULT));
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : COMPACT_KEEP_TURNS_DEFAULT;
}

export function compactThreshold(): number {
  const n = Number(env(OCULEAU_ENV.COMPACT_THRESHOLD) ?? String(COMPACT_THRESHOLD_DEFAULT));
  return Number.isFinite(n) && n > 0 ? n : COMPACT_THRESHOLD_DEFAULT;
}

export function compactAutoDefault(): boolean {
  return envFlag(OCULEAU_ENV.COMPACT_AUTO);
}

export function codeReplDefaultRuntime(): string {
  return env(OCULEAU_ENV.CODE_REPL_DEFAULT_RUNTIME) ?? CODE_REPL_DEFAULT_RUNTIME;
}

export function codeReplTimeoutMs(): number {
  const n = Number(env(OCULEAU_ENV.CODE_REPL_TIMEOUT_MS) ?? String(CODE_REPL_TIMEOUT_MS_DEFAULT));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : CODE_REPL_TIMEOUT_MS_DEFAULT;
}

export function pythonPath(): string | undefined {
  return env(OCULEAU_ENV.PYTHON);
}

export function venvPath(): string | undefined {
  return env(OCULEAU_ENV.VENV);
}

export function codeReplDisabled(): boolean {
  return envFlag(OCULEAU_ENV.CODE_REPL_DISABLED);
}

export function deepResearchEnabled(): boolean {
  return envFlag(OCULEAU_ENV.DEEP_RESEARCH);
}

export function tavilyApiKey(): string | undefined {
  return env(OCULEAU_ENV.TAVILY_API_KEY) ?? process.env[PROVIDER_ENV.TAVILY_API_KEY];
}

export function thinkingModeDefault(): boolean {
  return envFlag(OCULEAU_ENV.THINKING);
}

export function verboseModeDefault(): boolean {
  return envFlag(OCULEAU_ENV.VERBOSE);
}

export function httpFetchEnabled(): boolean {
  const value = env(OCULEAU_ENV.HTTP);
  if (value === "0") {
    return false;
  }
  return true;
}
