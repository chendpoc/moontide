import { describe, expect, it } from "vitest";

import { collectStatusSnapshot, setReplPhase } from "../src/cli/statusline/collect.js";
import { formatStatusLine, formatStatusLineVerbose } from "../src/cli/statusline/format.js";
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
  it("renders compact single line with circle pills", () => {
    const line = formatStatusLine(baseSnapshot());
    const text = stripAnsi(line);
    expect(line.split("\n")).toHaveLength(1);
    expect(text).toContain("Oculeau");
    expect(text).toContain("idle");
    expect(text).toContain("ctx");
    expect(text).toContain("t—");
  });

  it("shows enabled pills and turn in compact mode", () => {
    const line = formatStatusLine(
      baseSnapshot({
        context: { enabled: true, detail: "12.3%" },
        trace: { enabled: true },
        turn: 3,
      }),
    );
    const text = stripAnsi(line);
    expect(text).toContain("t3");
    expect(text).toContain("12.3%");
  });

  it("verbose mode includes model and channel names", () => {
    const line = formatStatusLineVerbose(baseSnapshot({ turn: 2 }));
    const text = stripAnsi(line);
    expect(text).toContain("ctx OFF");
    expect(text).toContain("deepseek-v4-pro");
    expect(text).toContain("turn 2");
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
