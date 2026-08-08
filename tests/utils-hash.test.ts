import { describe, expect, it } from "vitest";

import { sha256Hex, sha256UInt32Be } from "@moontide/shared/utils/hash.js";

describe("utils/hash", () => {
  it("computes stable sha256 hex", () => {
    expect(sha256Hex("rules")).toBe(
      "6c621d1a05138a7888d37d9269a9da8e2e11e4aced2f6cfd24b05ab1b9e61bb0",
    );
  });

  it("derives a non-zero uint32 epoch", () => {
    expect(sha256UInt32Be("rules")).toBeGreaterThan(0);
  });
});
