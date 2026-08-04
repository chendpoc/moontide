import { describe, expect, it } from "vitest";

import type { MessageParam } from "@anthropic-ai/sdk/resources/messages/messages.js";

import { previewCompact, pruneCompact } from "../src/context/compact.js";
import { buildDefaultBasePrompt } from "../src/agent/prompt.js";
import { getToolDefinitions } from "../src/tools/index.js";
import { getTestRuntime, installTestRuntime } from "./helpers/test-runtime.js";

function longToolResultMessage(): MessageParam[] {
  const big = "x".repeat(5000);
  return [
    { role: "user", content: "read files" },
    {
      role: "assistant",
      content: [{ type: "tool_use", id: "t1", name: "Read", input: { path: "a.ts" } }],
    },
    {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "t1", content: big }],
    },
    { role: "user", content: "second question" },
    {
      role: "assistant",
      content: [{ type: "text", text: "done" }],
    },
    { role: "user", content: "third question" },
  ];
}

describe("context compact", () => {
  installTestRuntime();
  const runtime = getTestRuntime();
  const system = buildDefaultBasePrompt();

  it("preview shows token reduction for old tool results", () => {
    const messages = longToolResultMessage();
    const preview = previewCompact(messages, system, getToolDefinitions(runtime), 1);
    expect(preview.wouldChange).toBe(true);
    expect(preview.afterTokens).toBeLessThan(preview.beforeTokens);
    expect(preview.truncatedToolResults).toBeGreaterThan(0);
  });

  it("prune mutates tool results in older turns", () => {
    const messages = longToolResultMessage();
    const result = pruneCompact(messages, system, getToolDefinitions(runtime), 1);
    expect(result.changed).toBe(true);
    expect(result.afterTokens).toBeLessThan(result.beforeTokens);
    const firstUserTool = result.messages[2];
    expect(typeof firstUserTool.content).not.toBe("string");
    if (Array.isArray(firstUserTool.content)) {
      const block = firstUserTool.content[0];
      if (block.type === "tool_result") {
        expect(String(block.content)).toContain("[compact:");
      }
    }
  });

  it("returns unchanged for empty messages", () => {
    const result = pruneCompact([], system, getToolDefinitions(runtime));
    expect(result.changed).toBe(false);
  });
});
