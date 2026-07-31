import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  isThinkingEnabled,
  isVerboseEnabled,
  resetObservabilityOverrides,
  setThinkingOverride,
  setVerboseOverride,
} from "../src/events/modes.js";
import {
  composeTerminalBlock,
  formatTerminalEventBlock,
  resetTerminalRenderState,
  shouldPrintTerminalEvent,
} from "../src/events/format/terminal.js";
import { stripAnsi } from "../src/utils/text.js";
import { StderrRenderer } from "../src/events/outputs/stderr-renderer.js";
import { setStderrWriterForTest } from "../src/events/outputs/stderr-writer.js";
import type { AgentEvent } from "../src/events/types.js";
import type { ContextReport } from "../src/context/types.js";

const THINKING_KEY = "OCULA_THINKING";
const VERBOSE_KEY = "OCULA_VERBOSE";

function baseEvent(overrides: Partial<AgentEvent>): AgentEvent {
  return {
    id: "e1",
    seq: 1,
    runId: "run-1",
    turn: 1,
    phase: "post_llm",
    channel: "trace",
    kind: "thinking",
    ts: Date.now(),
    payload: {},
    ...overrides,
  };
}

function sampleReport(overrides: Partial<ContextReport> = {}): ContextReport {
  return {
    turn: 1,
    estimatedTokens: 1200,
    limit: 128_000,
    headroom: 126_800,
    percentUsed: 0.9,
    breakdown: {
      system: 100,
      toolSchemas: 200,
      user: 300,
      assistant: 400,
      thinking: 50,
      toolResults: 150,
      total: 1200,
    },
    structure: { messageCount: 3, toolCallCount: 1 },
    messageLines: [],
    trend: { deltaTokens: 100, cumulativeTokens: 1200 },
    alerts: [],
    ...overrides,
  };
}

describe("observability modes", () => {
  beforeEach(() => {
    delete process.env[THINKING_KEY];
    delete process.env[VERBOSE_KEY];
    resetObservabilityOverrides();
  });

  afterEach(() => {
    delete process.env[THINKING_KEY];
    delete process.env[VERBOSE_KEY];
    resetObservabilityOverrides();
  });

  it("defaults both modes off", () => {
    expect(isThinkingEnabled()).toBe(false);
    expect(isVerboseEnabled()).toBe(false);
  });

  it("enables thinking from env or override", () => {
    process.env[THINKING_KEY] = "1";
    expect(isThinkingEnabled()).toBe(true);

    resetObservabilityOverrides();
    delete process.env[THINKING_KEY];
    setThinkingOverride(true);
    expect(isThinkingEnabled()).toBe(true);
  });

  it("verbose implies thinking", () => {
    setVerboseOverride(true);
    expect(isVerboseEnabled()).toBe(true);
    expect(isThinkingEnabled()).toBe(true);
  });
});

describe("terminal event formatting", () => {
  beforeEach(() => {
    resetObservabilityOverrides();
    resetTerminalRenderState();
    delete process.env[THINKING_KEY];
    delete process.env[VERBOSE_KEY];
  });

  afterEach(() => {
    resetObservabilityOverrides();
    resetTerminalRenderState();
  });

  it("prints trace call chain in thinking mode", () => {
    setThinkingOverride(true);

    expect(
      shouldPrintTerminalEvent(
        baseEvent({ kind: "thinking", payload: { body: "plan read file" } }),
      ),
    ).toBe(true);
    expect(
      shouldPrintTerminalEvent(baseEvent({ kind: "tool_use", payload: { toolName: "read_file" } })),
    ).toBe(true);
    expect(
      shouldPrintTerminalEvent(
        baseEvent({ kind: "assistant_text", payload: { body: "done" } }),
      ),
    ).toBe(false);
    expect(
      shouldPrintTerminalEvent(baseEvent({ channel: "context", kind: "context_metrics" })),
    ).toBe(false);
  });

  it("prints all channels in verbose mode", () => {
    setVerboseOverride(true);

    expect(
      shouldPrintTerminalEvent(baseEvent({ channel: "context", kind: "context_metrics" })),
    ).toBe(true);
    expect(
      shouldPrintTerminalEvent(
        baseEvent({ channel: "audit", kind: "tool_use", payload: { toolName: "bash" } }),
      ),
    ).toBe(true);
    expect(
      shouldPrintTerminalEvent(
        baseEvent({ channel: "conversation", kind: "user_prompt", preview: "hello" }),
      ),
    ).toBe(true);
  });

  it("formats trace steps with think label and tool name", () => {
    setThinkingOverride(true);
    const block = formatTerminalEventBlock(
      baseEvent({
        kind: "tool_use",
        payload: {
          toolName: "read_file",
          input: { path: "src/main.ts" },
        },
        preview: "read_file path=src/main.ts",
      }),
    );
    const text = stripAnsi(block ?? "");
    expect(text).toContain("turn 01");
    expect(text).toContain("tool");
    expect(text).toContain("read_file");
  });

  it("formats context metrics as boxed output in verbose mode", () => {
    setVerboseOverride(true);
    const block = formatTerminalEventBlock(
      baseEvent({
        channel: "context",
        kind: "context_metrics",
        payload: { report: sampleReport() },
      }),
    );
    const text = stripAnsi(block ?? "");
    expect(text).toContain("CONTEXT");
    expect(text).toContain("Tokens");
    expect(text).toContain("Usage");
  });

  it("formats audit events with EVENT marker in verbose mode", () => {
    setVerboseOverride(true);
    const block = formatTerminalEventBlock(
      baseEvent({
        channel: "audit",
        kind: "tool_use",
        payload: { toolName: "bash", toolInput: { command: "ls" } },
      }),
    );
    const text = stripAnsi(block ?? "");
    expect(text).toContain("EVENT");
    expect(text).toContain("audit");
    expect(text).toContain("bash");
  });

  it("inserts turn banner when turn changes", () => {
    resetTerminalRenderState();
    const block1 = composeTerminalBlock(
      baseEvent({ turn: 1, kind: "thinking", payload: { body: "a" } }),
      "line-a",
    );
    const block2 = composeTerminalBlock(
      baseEvent({ turn: 2, kind: "thinking", payload: { body: "b" } }),
      "line-b",
    );
    expect(stripAnsi(block1)).toContain("turn 01");
    expect(stripAnsi(block2)).toContain("turn 02");
  });

  it("inserts channel separator when channel changes within same turn", () => {
    resetTerminalRenderState();
    composeTerminalBlock(
      baseEvent({ turn: 1, channel: "trace", kind: "thinking", payload: { body: "a" } }),
      "trace-line",
    );
    const block = composeTerminalBlock(
      baseEvent({
        turn: 1,
        channel: "context",
        kind: "context_metrics",
        payload: { report: sampleReport() },
      }),
      "context-line",
    );
    expect(stripAnsi(block)).toContain("trace → context");
  });
});

describe("StderrRenderer", () => {
  beforeEach(() => {
    resetObservabilityOverrides();
    resetTerminalRenderState();
    delete process.env[THINKING_KEY];
  });

  afterEach(() => {
    resetObservabilityOverrides();
    resetTerminalRenderState();
    setStderrWriterForTest(null);
  });

  it("writes formatted trace blocks when thinking is on", () => {
    setThinkingOverride(true);
    const lines: string[] = [];
    setStderrWriterForTest((chunk) => {
      lines.push(chunk);
      return true;
    });

    const renderer = new StderrRenderer();
    renderer.handle(
      baseEvent({
        kind: "thinking",
        payload: { body: "inspect repo layout" },
        preview: "inspect repo layout",
      }),
    );

    const text = stripAnsi(lines.join(""));
    expect(text).toContain("turn 01");
    expect(text).toContain("inspect repo layout");
  });

  it("is silent when observability is off", () => {
    const lines: string[] = [];
    setStderrWriterForTest((chunk) => {
      lines.push(chunk);
      return true;
    });

    const renderer = new StderrRenderer();
    renderer.handle(baseEvent({ kind: "thinking", payload: { body: "hidden" } }));

    expect(lines).toHaveLength(0);
  });
});
