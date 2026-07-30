import { httpFetchEnabled } from "../config.js";
import { clampInt } from "../utils/number.js";

export interface HttpFetchInput {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  max_bytes?: number;
  timeout_ms?: number;
}

export interface HttpFetchResult {
  status: "ok" | "error";
  url?: string;
  http_status?: number;
  headers?: Record<string, string>;
  body?: string;
  truncated?: boolean;
  error?: string;
}

const DEFAULT_MAX_BYTES = 51_200;
const MAX_BYTES_CAP = 51_200;
const DEFAULT_TIMEOUT_MS = 30_000;

const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "metadata.google.internal",
  "169.254.169.254",
]);

export function normalizeMaxBytes(maxBytes?: number): number {
  if (maxBytes === undefined || !Number.isFinite(maxBytes)) {
    return DEFAULT_MAX_BYTES;
  }
  return clampInt(maxBytes, 1, MAX_BYTES_CAP);
}

export function normalizeTimeoutMs(timeoutMs?: number): number {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs)) {
    return DEFAULT_TIMEOUT_MS;
  }
  return clampInt(timeoutMs, 1_000, 120_000);
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return false;
  }
  const [a, b] = parts;
  if (a === 10) {
    return true;
  }
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 127) {
    return true;
  }
  return false;
}

export function validateFetchUrl(rawUrl: string): URL | { error: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { error: "invalid URL" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { error: `unsupported protocol: ${parsed.protocol}` };
  }

  const host = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host) || host.endsWith(".localhost")) {
    return { error: "blocked host (SSRF protection)" };
  }
  if (isPrivateIpv4(host)) {
    return { error: "blocked private IP (SSRF protection)" };
  }

  return parsed;
}

const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

export async function runHttpFetch(input: HttpFetchInput): Promise<string> {
  if (!httpFetchEnabled()) {
    return JSON.stringify({
      status: "error",
      error: "http_fetch is disabled (set OCULEAU_HTTP unset or not 0)",
    } satisfies HttpFetchResult);
  }

  const rawUrl = String(input.url ?? "").trim();
  if (!rawUrl) {
    return JSON.stringify({
      status: "error",
      error: "url is required",
    } satisfies HttpFetchResult);
  }

  const urlCheck = validateFetchUrl(rawUrl);
  if ("error" in urlCheck) {
    return JSON.stringify({
      status: "error",
      url: rawUrl,
      error: urlCheck.error,
    } satisfies HttpFetchResult);
  }

  const method = String(input.method ?? "GET").toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    return JSON.stringify({
      status: "error",
      error: `unsupported method: ${method}`,
    } satisfies HttpFetchResult);
  }

  const maxBytes = normalizeMaxBytes(input.max_bytes);
  const timeoutMs = normalizeTimeoutMs(input.timeout_ms);
  const headers =
    input.headers && typeof input.headers === "object"
      ? Object.fromEntries(
          Object.entries(input.headers).map(([key, value]) => [key, String(value)]),
        )
      : undefined;

  try {
    const response = await fetch(urlCheck.toString(), {
      method,
      headers,
      body: method === "GET" || method === "DELETE" ? undefined : String(input.body ?? ""),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const buffer = Buffer.from(await response.arrayBuffer());
    const truncated = buffer.length > maxBytes;
    const body = buffer.subarray(0, maxBytes).toString("utf8");

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return JSON.stringify({
      status: "ok",
      url: urlCheck.toString(),
      http_status: response.status,
      headers: responseHeaders,
      body,
      ...(truncated ? { truncated: true } : {}),
    } satisfies HttpFetchResult);
  } catch (error) {
    return JSON.stringify({
      status: "error",
      url: rawUrl,
      error: error instanceof Error ? error.message : String(error),
    } satisfies HttpFetchResult);
  }
}
