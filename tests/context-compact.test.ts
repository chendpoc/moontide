import { describe, expect, it } from "vitest";

import type { Message } from "@moontide/llm/protocol";

import {
  previewCompact,
  pruneCompact,
  estimateDialogueCompactionTokens,
} from "@moontide/context-composer";
import { buildDefaultBasePrompt } from "../packages/agent/src/agent/prompt.js";
import { getToolDefinitions } from "../packages/agent/src/tools/index.js";
import { getTestRuntime, installTestRuntime } from "./helpers/test-runtime.js";

const compactOptions = { keepTurns: 1, modelId: "claude-test" };

function longToolResultMessage(): Message[] {
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
  const tools = getToolDefinitions(runtime.tools);

  it("preview shows token reduction for old tool results", () => {
    const messages = longToolResultMessage();
    const preview = previewCompact(messages, system, tools, compactOptions);
    expect(preview.wouldChange).toBe(true);
    expect(preview.afterTokens).toBeLessThan(preview.beforeTokens);
    expect(preview.truncatedToolResults).toBeGreaterThan(0);
    expect(preview.beforeTokens).toBe(estimateDialogueCompactionTokens(messages, "claude-test"));
  });

  it("prune mutates tool results in older turns", () => {
    const messages = longToolResultMessage();
    const result = pruneCompact(messages, system, tools, compactOptions);
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
    const result = pruneCompact([], system, tools, compactOptions);
    expect(result.changed).toBe(false);
  });
});
