#!/usr/bin/env tsx
/**
 * LLM API smoke test — verify API key, base URL, and model before running the REPL.
 */
import { PING_MAX_TOKENS } from "@moontide/shared/constants/llm.js";
import { toMessage } from "@moontide/shared/errors/normalize.js";

import { extractText } from "../normalize/extract-text.js";
import { getLLMProvider } from "../provider.js";
import { resolveRoute } from "../routing/resolve.js";

async function ping(userText: string): Promise<string> {
  const route = resolveRoute();
  const response = await getLLMProvider(route).chat({
    model: route.vendorModelId,
    system: "",
    messages: [{ role: "user", content: userText }],
    tools: [],
    maxTokens: PING_MAX_TOKENS,
  });
  if (!response.content.length) {
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
    console.error(`Error: ${toMessage(error)}`);
    process.exit(1);
  }
}

main();
