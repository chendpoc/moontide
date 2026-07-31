import { describe, expect, it } from "vitest";

import { buildContextReport } from "../src/context/analyze.js";
import { formatContext, getSummary } from "../src/context/format.js";
import { estimateBreakdown, estimateTextTokens, buildMessageLines } from "../src/context/metrics.js";
import { buildSnapshot } from "../src/context/snapshot.js";
import { resetSession, updateSessionFromSnapshot } from "../src/context/sessions.js";
import type { ContextSnapshot } from "../src/context/types.js";

function makeSnapshot(overrides: Partial<ContextSnapshot> = {}): ContextSnapshot {
  return {
    turn: 1,
    modelId: "deepseek-v4-pro",
    system: "You are Ocula.",
    tools: [
      {
        name: "read_file",
        description: "Read a file",
        input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      },
    ],
    messages: [
      { role: "user", content: "hello" },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Let me think", signature: "sig" },
          { type: "text", text: "Hi there" },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "tu_1", content: "file contents here" }],
      },
    ],
    ...overrides,
  };
}

describe("context metrics", () => {
  it("estimates text tokens with a simple heuristic", () => {
    expect(estimateTextTokens("hello world")).toBeGreaterThan(0);
    expect(estimateTextTokens("")).toBe(0);
  });

  it("breaks down system, tools, thinking, and tool results", () => {
    const breakdown = estimateBreakdown(makeSnapshot());
    expect(breakdown.system).toBeGreaterThan(0);
    expect(breakdown.toolSchemas).toBeGreaterThan(0);
    expect(breakdown.thinking).toBeGreaterThan(0);
    expect(breakdown.toolResults).toBeGreaterThan(0);
    expect(breakdown.total).toBe(
      breakdown.system +
        breakdown.toolSchemas +
        breakdown.user +
        breakdown.assistant +
        breakdown.thinking +
        breakdown.toolResults,
    );
  });
});

describe("context analyze/format", () => {
  it("builds a report with alerts when usage is high", () => {
    const longContent = "x".repeat(500_000);
    const report = buildContextReport(
      makeSnapshot({
        messages: [{ role: "user", content: longContent }],
      }),
    );
    expect(report.alerts.length).toBeGreaterThan(0);
    expect(report.percentUsed).toBeGreaterThan(70);
  });

  it("formats summary and struct views", () => {
    const report = buildContextReport(makeSnapshot());
    expect(getSummary(report)).toContain("Turn 1");
    expect(formatContext(report, "struct")).toContain("messages[3]");
    expect(formatContext(report, "breakdown")).toContain("tool_results:");
  });

  it("includes tool_result preview and tool_use_id in message lines", () => {
    const lines = buildMessageLines(makeSnapshot());
    const toolResultLine = lines.find((line) => line.preview.includes("file contents here"));
    expect(toolResultLine).toBeDefined();
    expect(toolResultLine?.details?.some((detail) => detail.kind === "tool_result")).toBe(true);
    expect(toolResultLine?.details?.[0]?.toolUseId).toBe("tu_1");
  });

  it("tracks turn-to-turn delta via session state", () => {
    resetSession();
    const turn1 = buildContextReport(makeSnapshot({ turn: 1 }));
    updateSessionFromSnapshot(makeSnapshot({ turn: 1 }), turn1);

    const turn2 = buildContextReport(
      makeSnapshot({
        turn: 2,
        messages: [
          { role: "user", content: "hello" },
          { role: "user", content: "another message with more content than before" },
        ],
      }),
      turn1.estimatedTokens,
    );

    expect(turn2.trend.deltaTokens).toBe(turn2.estimatedTokens - turn1.estimatedTokens);
  });
});

describe("buildSnapshot", () => {
  it("reads hook context fields", () => {
    const snapshot = buildSnapshot({
      turn: 2,
      system: "system prompt",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
    });
    expect(snapshot.turn).toBe(2);
    expect(snapshot.system).toBe("system prompt");
    expect(snapshot.messages).toHaveLength(1);
  });
});

describe("context plugin metrics events", () => {
  it("builds context_metrics payload with ContextReport fields", () => {
    const snapshot = makeSnapshot({ turn: 2 });
    const report = buildContextReport(snapshot);
    const draft = {
      turn: snapshot.turn,
      phase: "post_llm" as const,
      channel: "context" as const,
      kind: "context_metrics" as const,
      payload: { report },
      preview: `est ${report.estimatedTokens}/${report.limit} est`,
    };

    expect(draft.kind).toBe("context_metrics");
    expect(draft.payload.report).toMatchObject({
      turn: 2,
      estimatedTokens: report.estimatedTokens,
      limit: report.limit,
      headroom: report.headroom,
    });
  });
});
