import { describe, expect, it } from "vitest";

import { collectStatusSnapshot, setReplPhase } from "../src/cli/statusline/collect.js";
import { formatStatusLine, formatStatusLineVerbose } from "../src/cli/statusline/format.js";
import type { StatusSnapshot } from "../src/cli/statusline/types.js";
import { renderStatusLine, resetStatusLineRender } from "../src/cli/statusline/render.js";

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex -- intentional ANSI escape stripping
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

function baseSnapshot(overrides: Partial<StatusSnapshot> = {}): StatusSnapshot {
  return {
    phase: "idle",
    model: "deepseek-v4-pro",
    workdir: "~/code/oculeau",
    turn: null,
    contextPct: null,
    ...overrides,
  };
}

describe("statusline format", () => {
  it("renders compact single line with context and turn", () => {
    const line = formatStatusLine(baseSnapshot());
    const text = stripAnsi(line);
    expect(line.split("\n")).toHaveLength(1);
    expect(text).toContain("Oculeau");
    expect(text).toContain("idle");
    expect(text).toContain("context");
    expect(text).toContain("turn —");
  });

  it("shows context percent and turn when available", () => {
    const line = formatStatusLine(
      baseSnapshot({
        contextPct: 12.3,
        turn: 3,
      }),
    );
    const text = stripAnsi(line);
    expect(text).toContain("12.3%");
    expect(text).toContain("turn 3");
  });

  it("verbose mode includes model and context", () => {
    const line = formatStatusLineVerbose(baseSnapshot({ turn: 2, contextPct: 8.5 }));
    const text = stripAnsi(line);
    expect(text).toContain("context 8.5%");
    expect(text).toContain("deepseek-v4-pro");
    expect(text).toContain("turn 2");
  });
});

describe("statusline collect", () => {
  it("collects session fields without display channel toggles", () => {
    setReplPhase("idle");
    const snapshot = collectStatusSnapshot();
    expect(snapshot.phase).toBe("idle");
    expect(snapshot.model).toBeTruthy();
    expect(snapshot.workdir).toBeTruthy();
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
