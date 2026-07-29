import { describe, expect, it } from "vitest";

import { collectStatusSnapshot, setReplPhase } from "../src/cli/statusline/collect.js";
import { formatStatusLine } from "../src/cli/statusline/format.js";
import type { StatusSnapshot } from "../src/cli/statusline/types.js";
import {
  setContextCliOverride,
  setEventsDisplayCliOverride,
  setTraceCliOverride,
} from "../src/events/cli-session.js";
import { stripAnsi } from "../src/events/format/shared.js";
import { renderStatusLine, resetStatusLineRender } from "../src/cli/statusline/render.js";

function baseSnapshot(overrides: Partial<StatusSnapshot> = {}): StatusSnapshot {
  return {
    phase: "idle",
    model: "deepseek-v4-pro",
    workdir: "~/code/oculeau",
    turn: null,
    contextPct: null,
    context: { enabled: false },
    trace: { enabled: false },
    eventsStream: { enabled: false },
    eventsDisplay: { enabled: false },
    ...overrides,
  };
}

describe("statusline format", () => {
  it("renders a single line with all channels OFF by default", () => {
    const line = formatStatusLine(baseSnapshot());
    const text = stripAnsi(line);
    expect(line.split("\n")).toHaveLength(1);
    expect(text).toContain("ctx OFF");
    expect(text).toContain("trace OFF");
    expect(text).toContain("stream OFF");
    expect(text).toContain("display OFF");
    expect(text).toContain("idle");
  });

  it("shows ON pills with detail when enabled", () => {
    const line = formatStatusLine(
      baseSnapshot({
        context: { enabled: true, detail: "12.3%" },
        trace: { enabled: true },
        turn: 3,
      }),
    );
    const text = stripAnsi(line);
    expect(text).toContain("ctx ON");
    expect(text).toContain("12.3%");
    expect(text).toContain("trace ON");
    expect(text).toContain("turn 3");
  });

  it("shows context pct summary when display is off", () => {
    const line = formatStatusLine(
      baseSnapshot({
        context: { enabled: false, detail: "5.0%" },
      }),
    );
    const text = stripAnsi(line);
    expect(text).toContain("ctx OFF");
    expect(text).toContain("(5.0%)");
  });
});

describe("statusline collect", () => {
  it("defaults all display channels off without env overrides", () => {
    setContextCliOverride(null);
    setTraceCliOverride(null);
    setEventsDisplayCliOverride(null);
    setReplPhase("idle");
    const snapshot = collectStatusSnapshot();
    expect(snapshot.context.enabled).toBe(false);
    expect(snapshot.trace.enabled).toBe(false);
    expect(snapshot.eventsDisplay.enabled).toBe(false);
  });
});

describe("statusline render", () => {
  it("skips duplicate stderr when snapshot unchanged", () => {
    resetStatusLineRender();
    const writes: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      renderStatusLine();
      renderStatusLine();
      expect(writes).toHaveLength(1);
    } finally {
      process.stderr.write = original;
      resetStatusLineRender();
    }
  });
});
