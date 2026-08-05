import type { ContentBlock as SdkContentBlock } from "@anthropic-ai/sdk/resources/messages/messages.js";

import { mapSdkContentBlocks as mapBlocksFromRegistry } from "./block-registry.js";
import type { ToolResultSummary } from "./types.js";
import { truncateChars } from "../utils/text.js";
import { byteLengthUtf8 } from "../utils/utf8.js";

const SUMMARY_CHAR_LIMIT = 500;

/** Map SDK assistant blocks to MoonTide protocol blocks for Session Log. */
export function mapSdkContentBlocks(blocks: SdkContentBlock[]) {
  return mapBlocksFromRegistry(blocks);
}

export function summarizeToolResultContent(content: string): ToolResultSummary {
  const { text, truncated } = truncateChars(content, SUMMARY_CHAR_LIMIT);
  const lineCount = content.length === 0 ? 0 : content.split("\n").length;
  return {
    summary: text,
    byteCount: byteLengthUtf8(content),
    lineCount,
    truncated,
  };
}

export function userMessageText(content: string | SdkContentBlock[]): string {
  if (typeof content === "string") {
    return content;
  }
  return content
    .filter((block): block is Extract<SdkContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}
