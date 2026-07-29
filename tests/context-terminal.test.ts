import chalk from "chalk";
import { describe, expect, it, beforeEach } from "vitest";

import { buildContextReport } from "../src/context/analyze.js";
import { renderPostLlmVerbose, renderPreLlmVerbose } from "../src/context/terminal.js";
import type { ContextReport } from "../src/context/types.js";

function makeReport(overrides: Partial<ContextReport> = {}): ContextReport {
  const base = buildContextReport({
    turn: 2,
    modelId: "deepseek-v4-pro",
    system: "You are Oculus.",
    tools: [{ name: "read_file", description: "Read", input_schema: { type: "object", properties: {} } }],
    messages: [
      { role: "user", content: "hello" },
      {
        role: "assistant",
        content: [{ type: "text", text: "Hi there" }],
      },
    ],
  });

  return { ...base, ...overrides };
}

describe("context terminal verbose", () => {
  beforeEach(() => {
    chalk.level = 0;
  });

  it("renders pre-LLM summary lines with turn and token stats", () => {
    const lines = renderPreLlmVerbose(makeReport(), 1);
    const text = lines.join("\n");

    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(text).toContain("context");
    expect(text).toContain("pre-LLM");
    expect(text).toContain("turn 2");
    expect(text).toContain("headroom");
    expect(text).toContain("tool_calls");
  });

  it("renders struct tree at verbose level 2", () => {
    const lines = renderPreLlmVerbose(makeReport(), 2);
    const text = lines.join("\n");

    expect(text).toContain("breakdown");
    expect(text).toContain("system");
    expect(text).toContain("tool_schemas");
    expect(text).toContain("messages[2]");
    expect(text).toContain("[0]");
  });

  it("includes alert lines when usage is high", () => {
    const report = makeReport({
      percentUsed: 92,
      alerts: [{ level: "critical", message: "Context usage at 92.0% — compaction recommended" }],
    });

    const text = renderPreLlmVerbose(report, 1).join("\n");
    expect(text).toContain("!!");
    expect(text).toContain("compaction recommended");
  });

  it("renders post-LLM usage with estimate delta", () => {
    const report = makeReport({
      estimatedTokens: 1000,
      usage: { inputTokens: 1050, outputTokens: 120 },
    });

    const lines = renderPostLlmVerbose(report);
    expect(lines).not.toBeNull();

    const text = lines!.join("\n");
    expect(text).toContain("post-LLM");
    expect(text).toContain("API usage");
    expect(text).toContain("1,050");
    expect(text).toContain("120");
    expect(text).toContain("+50 vs est");
  });

  it("returns null for post-LLM when usage is missing", () => {
    expect(renderPostLlmVerbose(makeReport({ usage: undefined }))).toBeNull();
  });

  it("expands tool_result detail lines when enabled", () => {
    const body = ["line one", "line two", "line three"].join("\n");
    const report = buildContextReport({
      turn: 3,
      modelId: "deepseek-v4-pro",
      system: "You are Oculus.",
      tools: [],
      messages: [
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "tu_read", content: body }],
        },
      ],
    });

    const text = renderPreLlmVerbose(report, 2, true).join("\n");
    expect(text).toContain("tool_result detail ON");
    expect(text).toContain("tu_read");
    expect(text).toContain("line one");
    expect(text).toContain("line two");
  });
});
