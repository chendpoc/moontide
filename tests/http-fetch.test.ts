import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  normalizeMaxBytes,
  runHttpFetch,
  validateFetchUrl,
} from "../src/tools/builtins/network/http-fetch.js";

describe("http_fetch", () => {
  beforeEach(() => {
    delete process.env.MOONTIDE_HTTP;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete process.env.MOONTIDE_HTTP;
    vi.restoreAllMocks();
  });

  it("requires url", async () => {
    const raw = await runHttpFetch({ url: "  " });
    const result = JSON.parse(raw) as { status: string; error: string };
    expect(result.status).toBe("error");
    expect(result.error).toContain("url");
  });

  it("blocks localhost SSRF", () => {
    const result = validateFetchUrl("http://127.0.0.1/api");
    expect(result).toEqual({ error: "blocked host (SSRF protection)" });
  });

  it.each([
    { url: "http://127.0.0.2/api", error: "blocked private IP (SSRF protection)" },
    { url: "http://10.0.0.1/internal", error: "blocked private IP (SSRF protection)" },
    { url: "http://172.16.0.1/internal", error: "blocked private IP (SSRF protection)" },
    { url: "http://192.168.1.1/router", error: "blocked private IP (SSRF protection)" },
    { url: "http://169.254.1.1/metadata", error: "blocked private IP (SSRF protection)" },
    { url: "http://0.1.2.3/legacy", error: "blocked private IP (SSRF protection)" },
    { url: "http://localhost/api", error: "blocked host (SSRF protection)" },
    { url: "http://app.localhost/api", error: "blocked host (SSRF protection)" },
  ])("blocks SSRF url $url", ({ url, error }) => {
    expect(validateFetchUrl(url)).toEqual({ error });
  });

  it.each([
    "https://example.com/doc",
    "http://172.15.0.1/public",
  ])("allows public url %s", (url) => {
    expect(validateFetchUrl(url)).toBeInstanceOf(URL);
  });

  it("returns fetch body on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ ok: true }, { status: 200, headers: { "content-type": "application/json" } }),
      ),
    );

    const raw = await runHttpFetch({ url: "https://example.com/api" });
    const result = JSON.parse(raw) as { status: string; http_status: number; body: string };
    expect(result.status).toBe("ok");
    expect(result.http_status).toBe(200);
    expect(result.body).toContain("ok");
  });

  it("truncates large responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("x".repeat(100_000), { status: 200 })),
    );

    const raw = await runHttpFetch({ url: "https://example.com/big", max_bytes: 1000 });
    const result = JSON.parse(raw) as { status: string; truncated: boolean; body: string };
    expect(result.status).toBe("ok");
    expect(result.truncated).toBe(true);
    expect(result.body.length).toBe(1000);
  });

  it("is disabled when MOONTIDE_HTTP=0", async () => {
    process.env.MOONTIDE_HTTP = "0";
    const raw = await runHttpFetch({ url: "https://example.com" });
    const result = JSON.parse(raw) as { status: string; error: string };
    expect(result.status).toBe("error");
    expect(result.error).toContain("disabled");
  });

  it("caps max bytes", () => {
    expect(normalizeMaxBytes(999_999)).toBe(51200);
  });
});
