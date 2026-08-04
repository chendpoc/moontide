import { describe, expect, it } from "vitest";

import {
  blockMessageLabel,
  blockMessagePreview,
  estimateBlockTokens,
  mapSdkContentBlocks,
  traceDraftsFromBlocks,
} from "../src/session/block-registry.js";

describe("block-registry", () => {
  it("estimates text block tokens", () => {
    const part = estimateBlockTokens({ type: "text", text: "hello world" });
    expect(part.assistant).toBeGreaterThan(0);
    expect(part.thinking).toBe(0);
  });

  it("estimates tool_result block tokens", () => {
    const part = estimateBlockTokens({
      type: "tool_result",
      tool_use_id: "t1",
      content: "output line",
    });
    expect(part.toolResults).toBeGreaterThan(0);
    expect(part.maxToolResultChars).toBe("output line".length);
  });

  it("maps SDK text blocks", () => {
    expect(mapSdkContentBlocks([{ type: "text", text: "hi", citations: null }])).toEqual([
      { type: "text", text: "hi" },
    ]);
  });

  it("labels and previews text blocks via handler", () => {
    const block = { type: "text" as const, text: "hello world" };
    const part = estimateBlockTokens(block);
    expect(blockMessageLabel(block, part)).toMatch(/^text:/);
    expect(blockMessagePreview(block, part)).toContain("hello");
  });

  it("derives trace drafts from assistant blocks", () => {
    const drafts = traceDraftsFromBlocks(
      [
        { type: "thinking", thinking: "hmm" },
        { type: "text", text: "answer" },
      ],
      2,
    );
    expect(drafts).toHaveLength(2);
    expect(drafts[0]?.kind).toBe("thinking");
    expect(drafts[1]?.kind).toBe("assistant_text");
    expect(drafts[0]?.turn).toBe(2);
  });
});
