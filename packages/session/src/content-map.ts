import { mapContentBlocks } from "./block-registry.js";
import type { ContentBlock } from "@moontide/llm/protocol";
import type { ToolResultSummary } from "./types.js";
import { truncateChars } from "@moontide/shared/utils/text.js";
import { byteLengthUtf8 } from "@moontide/shared/utils/utf8.js";

export { mapContentBlocks };

export interface SummarizeToolResultOptions {
  /** Cap summary length when output was spilled (default: ~20% of artifact spill threshold). */
  maxSummaryChars?: number;
}

/**
 * Build ToolResultSummary for session log / compose.
 * Inline path (no maxSummaryChars): full text — used when byte size ≤ spill threshold.
 * Preview path (maxSummaryChars set): truncated preview — used after artifact spill only.
 */
export function summarizeToolResultContent(
  content: string,
  options?: SummarizeToolResultOptions,
): ToolResultSummary {
  const byteCount = byteLengthUtf8(content);
  const lineCount = content.length === 0 ? 0 : content.split("\n").length;

  if (options?.maxSummaryChars === undefined) {
    return {
      summary: content,
      byteCount,
      lineCount,
      truncated: false,
    };
  }

  const { text, truncated } = truncateChars(content, options.maxSummaryChars);
  return {
    summary: text,
    byteCount,
    lineCount,
    truncated,
  };
}

export function userMessageText(content: string | ContentBlock[]): string {
  if (typeof content === "string") {
    return content;
  }
  return content
    .filter((block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}
