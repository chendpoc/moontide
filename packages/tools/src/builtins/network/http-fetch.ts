import { APP_ENV, envVarName } from "@moontide/shared/constants/env.js";
import { toMessage } from "@moontide/shared/errors/normalize.js";
import { getToolsProductConfig } from "../../ports/product-config.js";
import { clampInt } from "@moontide/shared/utils/number.js";

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

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "metadata.google.internal",
  "169.254.169.254",
]);

type Ipv4SecondOctet = number | { min: number; max: number };

interface PrivateIpv4Rule {
  first: number;
  second?: Ipv4SecondOctet;
}

/** RFC1918, loopback, link-local, and this-network — first matching rule wins. */
const PRIVATE_IPV4_RULES: readonly PrivateIpv4Rule[] = [
  { first: 0 },
  { first: 10 },
  { first: 127 },
  { first: 169, second: 254 },
  { first: 172, second: { min: 16, max: 31 } },
  { first: 192, second: 168 },
];

function parseIpv4Octets(host: string): [number, number, number, number] | undefined {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return undefined;
  }
  return parts as [number, number, number, number];
}

function matchesSecondOctet(second: number, rule?: Ipv4SecondOctet): boolean {
  if (rule === undefined) {
    return true;
  }
  if (typeof rule === "number") {
    return second === rule;
  }
  return second >= rule.min && second <= rule.max;
}

function matchesPrivateIpv4(host: string): boolean {
  const octets = parseIpv4Octets(host);
  if (!octets) {
    return false;
  }
  const [first, second] = octets;
  return PRIVATE_IPV4_RULES.some(
    (rule) => rule.first === first && matchesSecondOctet(second, rule.second),
  );
}

const URL_BLOCK_RULES: readonly { error: string; match: (host: string) => boolean }[] = [
  {
    error: "blocked host (SSRF protection)",
    match: (host) => BLOCKED_HOSTNAMES.has(host) || host.endsWith(".localhost"),
  },
  {
    error: "blocked private IP (SSRF protection)",
    match: matchesPrivateIpv4,
  },
];

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
  for (const rule of URL_BLOCK_RULES) {
    if (rule.match(host)) {
      return { error: rule.error };
    }
  }

  return parsed;
}

const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

export async function runHttpFetch(input: HttpFetchInput): Promise<string> {
  if (!getToolsProductConfig().httpFetchEnabled()) {
    return JSON.stringify({
      status: "error",
      error: `http_fetch is disabled (set ${envVarName(APP_ENV.HTTP)} unset or not 0)`,
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
      error: toMessage(error),
    } satisfies HttpFetchResult);
  }
}
