import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlock,
  MessageParam,
  Tool,
} from "@anthropic-ai/sdk/resources/messages/messages.js";

import { apiKey, baseUrl, modelId } from "./config.js";

let client: Anthropic | undefined;

export function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: apiKey(), baseURL: baseUrl() });
  }
  return client;
}

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

export async function chat(
  messages: MessageParam[],
  tools: Tool[],
  system: string,
  maxTokens = 8000,
) {
  return getClient().messages.create({
    model: modelId(),
    system,
    messages,
    tools,
    max_tokens: maxTokens,
  });
}
