import { describe, expect, it } from "vitest";

import { clampInt } from "../src/utils/number.js";
import { formatIdTimestamp, newEventId, newTimestampedId } from "../src/utils/id.js";
import {
  dataDir,
  dataPath,
  isOutsideWorkspace,
  joinPath,
  resolveWorkspacePath,
  shortenHomePath,
} from "../src/utils/path.js";
import { escapeRegExp, truncateChars, truncateOneLine } from "../src/utils/text.js";
import { byteLengthUtf8, truncateUtf8 } from "../src/utils/utf8.js";

describe("utils/text", () => {
  it("truncateOneLine keeps short text unchanged", () => {
    expect(truncateOneLine("hello world")).toBe("hello world");
  });

  it("truncateOneLine collapses whitespace and truncates with default ellipsis", () => {
    const text = "a".repeat(50);
    expect(truncateOneLine(text, 10)).toBe(`${"a".repeat(9)}…`);
  });

  it("truncateOneLine supports custom ellipsis", () => {
    expect(truncateOneLine("hello world", 8, "...")).toBe("hello...");
  });

  it("truncateChars reports truncation", () => {
    expect(truncateChars("abc", 5)).toEqual({ text: "abc", truncated: false });
    expect(truncateChars("abcdef", 3)).toEqual({ text: "abc", truncated: true });
  });

  it("escapeRegExp escapes regex metacharacters", () => {
    expect(escapeRegExp("run-0001.jsonl.gz")).toBe("run-0001\\.jsonl\\.gz");
    expect(new RegExp(`^${escapeRegExp("a.b")}$`).test("a.b")).toBe(true);
  });
});

describe("utils/utf8", () => {
  it("truncateUtf8 preserves ASCII under limit", () => {
    expect(truncateUtf8("hello", 10)).toBe("hello");
  });

  it("truncateUtf8 does not split multibyte characters", () => {
    const text = "你好世界";
    const truncated = truncateUtf8(text, 7);
    expect(byteLengthUtf8(truncated)).toBeLessThanOrEqual(7);
    expect(text.startsWith(truncated)).toBe(true);
  });
});

describe("utils/number", () => {
  it("clampInt floors and clamps to range", () => {
    expect(clampInt(3.9, 1, 5)).toBe(3);
    expect(clampInt(99, 1, 10)).toBe(10);
    expect(clampInt(-1, 0, 10)).toBe(0);
  });
});

describe("utils/id", () => {
  it("formatIdTimestamp uses local YYYYMMDD-HHmmss", () => {
    expect(formatIdTimestamp(new Date(2026, 6, 30, 14, 30, 45))).toBe("20260730-143045");
  });

  it("newTimestampedId appends random hex suffix", () => {
    const id = newTimestampedId(new Date(2026, 6, 30, 14, 30, 45));
    expect(id).toMatch(/^20260730-143045-[0-9a-f]{8}$/);
  });

  it("newEventId returns a UUID", () => {
    expect(newEventId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

describe("utils/path", () => {
  it("joinPath joins segments cross-platform", () => {
    expect(joinPath("/tmp", "moontide", "sessions")).toBe("/tmp/moontide/sessions");
  });

  it("dataDir points at workdir/.moontide", () => {
    expect(dataDir("/tmp/workspace")).toBe("/tmp/workspace/.moontide");
  });

  it("dataPath joins under .moontide root", () => {
    expect(dataPath("/tmp/workspace", "sessions", "abc.jsonl")).toBe(
      "/tmp/workspace/.moontide/sessions/abc.jsonl",
    );
  });

  it("shortenHomePath replaces home prefix with tilde", () => {
    expect(shortenHomePath("/Users/me/proj", "/Users/me")).toBe("~/proj");
    expect(shortenHomePath("/tmp/proj", "/Users/me")).toBe("/tmp/proj");
  });

  it("resolveWorkspacePath resolves relative paths under workdir", () => {
    expect(resolveWorkspacePath("src/a.ts", "/tmp/workspace")).toBe("/tmp/workspace/src/a.ts");
  });

  it("resolveWorkspacePath rejects paths that escape workdir", () => {
    expect(() => resolveWorkspacePath("../etc/passwd", "/tmp/workspace")).toThrow(
      "Path escapes workspace",
    );
  });

  it("isOutsideWorkspace detects absolute and relative escapes", () => {
    const workdir = "/tmp/workspace";
    expect(isOutsideWorkspace("src/a.ts", workdir)).toBe(false);
    expect(isOutsideWorkspace("../outside", workdir)).toBe(true);
    expect(isOutsideWorkspace("/etc/passwd", workdir)).toBe(true);
  });
});
