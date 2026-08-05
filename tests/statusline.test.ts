import { describe, expect, it, afterEach } from "vitest";

import { collectStatusSnapshot, setReplPhase } from "../src/cli/statusline/collect.js";
import {
  formatSegmentCatalog,
  formatStatusLine,
  formatStatusLineVerbose,
} from "../src/cli/statusline/format.js";
import { formatCompactTokens, formatContextSegment } from "../src/cli/statusline/format-tokens.js";
import { formatActivityLine, resetActivityForTest, startActivityLine, stopActivityLine, advanceActivityFrameForTest } from "../src/cli/statusline/activity.js";
import { renderStatusSegments } from "../src/cli/statusline/segments.js";
import type { StatusSnapshot } from "../src/cli/statusline/types.js";
import { resetStatusLineRender, beginAgentActivity, endAgentActivity } from "../src/cli/statusline/render.js";
import { setVerboseOverride, resetObservabilityOverrides } from "../src/log/modes.js";
import { formatDeltaColored, formatDeltaPlain } from "../src/log/format/format-delta.js";
import { resetContextLangOverride } from "../src/i18n/context/index.js";
import { resetLocaleOverride, setLocaleOverride } from "../src/i18n/locale.js";
import { stripAnsi } from "../src/utils/text.js";

function baseSnapshot(overrides: Partial<StatusSnapshot> = {}): StatusSnapshot {
  return {
    phase: "idle",
    model: "deepseek-v4-pro",
    workdir: "~/code/moontide",
    runId: "run-1",
    turn: null,
    contextPct: null,
    contextUsed: null,
    contextLimit: null,
    contextDelta: null,
    contextHasBaseline: false,
    lastApiIn: null,
    lastApiOut: null,
    ...overrides,
  };
}

describe("statusline format", () => {
  afterEach(() => {
    resetLocaleOverride();
    resetContextLangOverride();
  });

  it("renders compact context segment", () => {
    expect(formatCompactTokens(2197)).toBe("2.2k");
    expect(formatCompactTokens(128_000)).toBe("128k");
    expect(formatContextSegment(baseSnapshot({
      contextUsed: 2197,
      contextLimit: 128_000,
      contextPct: 1.7,
    }))).toBe("L2 2.2k/128k(1.7%)");
  });

  it("renders resident status line from configured segments only", () => {
    setLocaleOverride("en");
    const line = formatStatusLine(baseSnapshot({
      contextUsed: 2197,
      contextLimit: 128_000,
      contextPct: 1.7,
      turn: 2,
    }));
    const text = stripAnsi(line);
    expect(text).toContain("MoonTide");
    expect(text).toContain("2.2k/128k(1.7%)");
    expect(text).toContain("turn 2");
    expect(text).toContain("deepseek-v4-pro");
    expect(text).toContain("~/code/moontide");
    expect(text).not.toContain("segments ");
    expect(text).not.toContain("idle");
    expect(text).not.toContain("running");
  });

  it("formatStatusLineVerbose matches segment-only output", () => {
    setLocaleOverride("en");
    const snapshot = baseSnapshot({
      turn: 2,
      contextUsed: 1000,
      contextLimit: 128_000,
      contextPct: 0.8,
    });
    expect(formatStatusLineVerbose(snapshot)).toBe(formatStatusLine(snapshot));
    expect(stripAnsi(formatStatusLineVerbose(snapshot))).toContain("1k/128k");
    expect(stripAnsi(formatStatusLineVerbose(snapshot))).not.toContain("segments ");
  });

  it("formats delta with git colors", () => {
    expect(stripAnsi(formatDeltaPlain(100))).toBe("+100 tok");
    expect(stripAnsi(formatDeltaColored(-50))).toBe("-50 tok");
  });

  it("lists segment catalog", () => {
    const catalog = formatSegmentCatalog(["product", "context", "turn"]);
    expect(catalog).toContain("[x] product");
    expect(catalog).toContain("[ ] api_in");
  });
});

describe("statusline activity", () => {
  afterEach(() => {
    resetObservabilityOverrides();
    endAgentActivity();
    resetActivityForTest();
    setReplPhase("idle");
  });

  it("shows activity line only while running", () => {
    resetActivityForTest();
    setReplPhase("idle");
    expect(formatActivityLine()).toBeNull();

    setReplPhase("running");
    expect(formatActivityLine()).toBeNull();

    startActivityLine();
    expect(stripAnsi(formatActivityLine() ?? "")).toMatch(/⠋|⠙|⠹/);
    stopActivityLine();
  });

  it("skips activity spinner when verbose is enabled", () => {
    setVerboseOverride(true);
    beginAgentActivity();
    expect(formatActivityLine()).toBeNull();
  });
});

describe("statusline collect", () => {
  it("collects session fields", () => {
    setReplPhase("idle");
    const snapshot = collectStatusSnapshot();
    expect(snapshot.model).toBeTruthy();
    expect(snapshot.workdir).toBeTruthy();
    expect(snapshot.runId).toBeTruthy();
  });
});

describe("statusline render", () => {
  it("skips duplicate stderr when snapshot unchanged", async () => {
    resetStatusLineRender();
    const writes: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      const { renderStatusLineAsync } = await import("../src/cli/statusline/render.js");
      await renderStatusLineAsync();
      await renderStatusLineAsync();
      expect(writes).toHaveLength(1);
    } finally {
      process.stderr.write = original;
      resetStatusLineRender();
    }
  });

  it("updates spinner in place on TTY instead of appending lines", async () => {
    resetStatusLineRender();
    const writes: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    const originalIsTTY = process.stderr.isTTY;

    process.stderr.write = ((chunk: string) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });

    try {
      setReplPhase("running");
      startActivityLine();
      const { renderStatusStackAsync } = await import("../src/cli/statusline/render-stack.js");
      await renderStatusStackAsync();
      expect(writes).toHaveLength(2);

      advanceActivityFrameForTest();
      await renderStatusStackAsync();
      expect(writes.length).toBeGreaterThan(2);
      expect(writes.slice(2).join("")).toContain("\x1b[2A");
    } finally {
      process.stderr.write = originalWrite;
      Object.defineProperty(process.stderr, "isTTY", { value: originalIsTTY, configurable: true });
      stopActivityLine();
      resetActivityForTest();
      resetStatusLineRender();
      setReplPhase("idle");
    }
  });
});

describe("statusline segments", () => {
  afterEach(() => {
    resetLocaleOverride();
    resetContextLangOverride();
  });

  it("supports optional api segments", () => {
    setLocaleOverride("en");
    const line = renderStatusSegments(
      baseSnapshot({ lastApiIn: 2604, lastApiOut: 133 }),
      ["product", "api_in", "api_out"],
    );
    const text = stripAnsi(line);
    expect(text).toContain("in 2,604 tok");
    expect(text).toContain("out 133 tok");
  });

  it("localizes labels for zh locale", () => {
    setLocaleOverride("zh");
    const line = renderStatusSegments(baseSnapshot({ turn: 2 }), ["product", "turn", "run"]);
    const text = stripAnsi(line);
    expect(text).toContain("轮次 2");
    expect(text).toContain("运行 run-1");
  });
});

describe("statusline unpin", () => {
  it("re-renders after external stderr write unpins the stack", async () => {
    resetStatusLineRender();
    const writes: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    const originalIsTTY = process.stderr.isTTY;

    process.stderr.write = ((chunk: string) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });

    try {
      const { renderStatusStackAsync } = await import("../src/cli/statusline/render-stack.js");
      const { reply } = await import("../src/cli/commands/io.js");

      await renderStatusStackAsync();
      expect(writes.length).toBeGreaterThan(0);

      reply("language: zh");
      await renderStatusStackAsync();
      expect(writes.length).toBeGreaterThan(1);
    } finally {
      process.stderr.write = originalWrite;
      Object.defineProperty(process.stderr, "isTTY", { value: originalIsTTY, configurable: true });
      resetStatusLineRender();
    }
  });
});
