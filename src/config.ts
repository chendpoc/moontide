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

let workdir = path.resolve(process.env.OCULUS_WORKDIR ?? process.cwd());

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
  const override = process.env.OCULUS_CONTEXT_LIMIT;
  if (override) {
    const parsed = Number(override);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return CONTEXT_LIMITS[modelId()] ?? CONTEXT_LIMITS.default;
}

export function contextVerbose(): 0 | 1 | 2 {
  const level = Number(process.env.OCULUS_CONTEXT_VERBOSE ?? "0");
  if (level >= 2) {
    return 2;
  }
  if (level >= 1) {
    return 1;
  }
  return 0;
}

export function contextLogPath(): string {
  return process.env.OCULUS_CONTEXT_LOG ?? ".oculus/context.jsonl";
}

export function contextExact(): boolean {
  return process.env.OCULUS_CONTEXT_EXACT === "1";
}

export function contextSnapshotEnabled(): boolean {
  return process.env.OCULUS_CONTEXT_SNAPSHOT === "1";
}
