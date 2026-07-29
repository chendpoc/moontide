#!/usr/bin/env tsx
/**
 * LLM API smoke test — verify API key, base URL, and model before running the REPL.
 */
import { modelId } from "../../src/config.js";
import { extractText, getClient } from "../../src/llm.js";

async function ping(userText: string): Promise<string> {
  const response = await getClient().messages.create({
    model: modelId(),
    max_tokens: 512,
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
