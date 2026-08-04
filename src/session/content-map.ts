import type { ContentBlock as SdkContentBlock } from "@anthropic-ai/sdk/resources/messages/messages.js";

import type { ContentBlock } from "../llm/protocol/types.js";
import type { ToolResultSummary } from "./types.js";
import { truncateChars } from "../utils/text.js";
import { byteLengthUtf8 } from "../utils/utf8.js";

const SUMMARY_CHAR_LIMIT = 500;

/** Map SDK assistant blocks to Ocula protocol blocks for Session Log. */
export function mapSdkContentBlocks(blocks: SdkContentBlock[]): ContentBlock[] {
  return blocks.flatMap((block): ContentBlock[] => {
    switch (block.type) {
      case "text":
        return [{ type: "text", text: block.text }];
      case "thinking":
        return [{ type: "thinking", thinking: block.thinking }];
      case "tool_use":
        return [
          {
            type: "tool_use",
            id: block.id,
            name: block.name,
            input: block.input as Record<string, unknown>,
          },
        ];
      default:
        return [];
    }
  });
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
