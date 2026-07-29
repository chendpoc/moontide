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
