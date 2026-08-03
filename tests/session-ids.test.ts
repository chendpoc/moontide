import { describe, expect, it } from "vitest";

import { newSessionId } from "../src/session/ids.js";

describe("newSessionId", () => {
  it("matches runId shape and is filesystem-safe", () => {
    const id = newSessionId(new Date("2026-07-31T16:00:00+08:00"));
    expect(id).toMatch(/^20260731-160000-[0-9a-f]{8}$/);
    expect(id).not.toContain("/");
  });
});
