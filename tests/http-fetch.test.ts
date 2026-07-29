import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  normalizeMaxBytes,
  runHttpFetch,
  validateFetchUrl,
} from "../src/builtins/http-fetch.js";

describe("http_fetch", () => {
  beforeEach(() => {
    delete process.env.OCULEAU_HTTP;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete process.env.OCULEAU_HTTP;
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
    expect("error" in result).toBe(true);
  });

  it("allows public https url", () => {
    const result = validateFetchUrl("https://example.com/doc");
    expect(result).toBeInstanceOf(URL);
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

  it("is disabled when OCULEAU_HTTP=0", async () => {
    process.env.OCULEAU_HTTP = "0";
    const raw = await runHttpFetch({ url: "https://example.com" });
    const result = JSON.parse(raw) as { status: string; error: string };
    expect(result.status).toBe("error");
    expect(result.error).toContain("disabled");
  });

  it("caps max bytes", () => {
    expect(normalizeMaxBytes(999_999)).toBe(51200);
  });
});
