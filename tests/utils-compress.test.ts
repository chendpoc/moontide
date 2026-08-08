import { describe, expect, it } from "vitest";

import { gunzipBuffer, gzipBuffer } from "@moontide/shared/utils/compress.js";

describe("utils/compress", () => {
  it("roundtrips gzip buffers", () => {
    const input = Buffer.from("hello archive");
    expect(gunzipBuffer(gzipBuffer(input)).toString("utf8")).toBe("hello archive");
  });
});
