#!/usr/bin/env tsx
/**
 * LLM API smoke test — verify API key, base URL, and model before running the REPL.
 */
import "../../bootstrap.js";
import { PING_MAX_TOKENS } from "../../constants/llm.js";
import { modelId } from "../../config.js";
import { extractText, getClient } from "../client/anthropic.js";

async function ping(userText: string): Promise<string> {
  const response = await getClient().messages.create({
    model: modelId(),
    max_tokens: PING_MAX_TOKENS,
    messages: [{ role: "user", content: userText }],
  });
  if (!response.content?.length) {
    return "(empty response)";
  }
  return extractText(response.content) || "(empty response)";
}

async function main(): Promise<void> {
  const message = process.argv[2];
  if (!message) {
    console.error("Usage: pnpm run ping -- <message>");
    process.exit(1);
  }
  try {
    console.log(await ping(message));
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

main();
