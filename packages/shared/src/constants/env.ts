import { PRODUCT_SLUG } from "./brand.js";

/** Prefix for MoonTide-specific environment variables. */
export const ENV_PREFIX = `${PRODUCT_SLUG.toUpperCase()}_` as const;

/** MoonTide-scoped env keys (without prefix). */
export const APP_ENV = {
  WORKDIR: "WORKDIR",
  CONTEXT_LIMIT: "CONTEXT_LIMIT",
  CONTEXT_EXACT: "CONTEXT_EXACT",
  CONTEXT_BUDGET_L1: "CONTEXT_BUDGET_L1",
  CONTEXT_BUDGET_L3: "CONTEXT_BUDGET_L3",
  CONTEXT_BUDGET_L4: "CONTEXT_BUDGET_L4",
  CONTEXT_BUDGET_L5: "CONTEXT_BUDGET_L5",
  CONTEXT_BUDGET_FLEX_PCT: "CONTEXT_BUDGET_FLEX_PCT",
  /** Enable L5 flex tier (default on; set 0/false/off to disable). */
  CONTEXT_BUDGET_FLEX: "CONTEXT_BUDGET_FLEX",
  COMPACT_KEEP_TURNS: "COMPACT_KEEP_TURNS",
  COMPACT_THRESHOLD: "COMPACT_THRESHOLD",
  COMPACT_AUTO: "COMPACT_AUTO",
  ARTIFACT_SPILL_THRESHOLD_BYTES: "ARTIFACT_SPILL_THRESHOLD_BYTES",
  TOOL_PREVIEW_CHARS: "TOOL_PREVIEW_CHARS",
  CODE_REPL_DEFAULT_RUNTIME: "CODE_REPL_DEFAULT_RUNTIME",
  CODE_REPL_TIMEOUT_MS: "CODE_REPL_TIMEOUT_MS",
  CODE_REPL_DISABLED: "CODE_REPL_DISABLED",
  PYTHON: "PYTHON",
  VENV: "VENV",
  DEEP_RESEARCH: "DEEP_RESEARCH",
  TAVILY_API_KEY: "TAVILY_API_KEY",
  THINKING: "THINKING",
  /** Reasoning depth override: off | low | medium | high (see llm routing). */
  THINKING_LEVEL: "THINKING_LEVEL",
  VERBOSE: "VERBOSE",
  TRACE_PREVIEW_CHARS: "TRACE_PREVIEW_CHARS",
  LANG: "LANG",
  DEBUG: "DEBUG",
  HTTP: "HTTP",
  /** Runtime profile: `dev` | `production` (see `appEnv()` in config). */
  ENV: "ENV",
  /** Provider preset id: `deepseek` | `anthropic` (see llm/presets). */
  PROVIDER: "PROVIDER",
  ALWAYS_ALLOW: "ALWAYS_ALLOW",
  SIDECAR_PLUGIN_ID: "SIDECAR_PLUGIN_ID",
} as const;

/** Full env var name, e.g. `${ENV_PREFIX}LANG`. */
export function envVarName(key: keyof typeof APP_ENV | string): string {
  return `${ENV_PREFIX}${key}`;
}

/** Provider / third-party env var names. */
export const PROVIDER_ENV = {
  DEEPSEEK_API_KEY: "DEEPSEEK_API_KEY",
  ANTHROPIC_API_KEY: "ANTHROPIC_API_KEY",
  ANTHROPIC_BASE_URL: "ANTHROPIC_BASE_URL",
  ANTHROPIC_AUTH_TOKEN: "ANTHROPIC_AUTH_TOKEN",
  MODEL_ID: "MODEL_ID",
  TAVILY_API_KEY: "TAVILY_API_KEY",
} as const;
