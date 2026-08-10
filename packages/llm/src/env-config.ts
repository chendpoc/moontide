import {
  APP_ENV,
  COMPACT_KEEP_TURNS_DEFAULT,
  COMPACT_THRESHOLD_DEFAULT,
  DEFAULT_MODEL,
  ENV_PREFIX,
  PROVIDER_ENV,
} from "@moontide/shared/constants/index.js";

function env(name: string): string | undefined {
  return process.env[`${ENV_PREFIX}${name}`];
}

function envFlag(name: string): boolean {
  return env(name) === "1";
}

export function modelId(): string {
  return process.env[PROVIDER_ENV.MODEL_ID] ?? DEFAULT_MODEL;
}

export function providerPresetId(): string | undefined {
  const raw = env(APP_ENV.PROVIDER)?.trim().toLowerCase();
  return raw || undefined;
}

export function adapterFamilyOverride(): string | undefined {
  const raw = env(APP_ENV.ADAPTER_FAMILY)?.trim();
  return raw || undefined;
}

export function contextLimitOverride(): number | undefined {
  const override = env(APP_ENV.CONTEXT_LIMIT);
  if (override) {
    const parsed = Number(override);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
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
