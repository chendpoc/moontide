import type { ContentBlock } from "../protocol/types.js";

export function extractText(content: string | ContentBlock[]): string {
  if (typeof content === "string") {
    return content.trim();
  }
  return content
    .filter((block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}
