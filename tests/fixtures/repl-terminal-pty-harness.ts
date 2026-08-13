/**
 * PTY harness for ReplTerminal + StatusStack integration tests.
 * Spawn via: node --import tsx tests/fixtures/repl-terminal-pty-harness.ts
 * Mode: HARNESS_MODE env (prompt-echo | status-dedup | final-message-only)
 *
 * Uses relative imports only so the subprocess does not depend on vitest aliases.
 */
import readline from "node:readline/promises";
import { stdin as input, stderr as output } from "node:process";

import { ReplTerminal } from "../../packages/agent-cli/src/cli/repl/terminal.js";
import {
  beginAgentActivity,
  endAgentActivity,
  resetStatusLineRender,
} from "../../packages/agent-cli/src/cli/statusline/render.js";
import {
  clearStatusStackCacheForTest,
  renderStatusStackAsync,
} from "../../packages/agent-cli/src/cli/statusline/render-stack.js";
import { replPrompt } from "../../packages/agent-cli/src/terminal/theme.js";

function marker(tag: string): void {
  process.stderr.write(`\n<<${tag}>>\n`);
}

async function runPromptEcho(): Promise<void> {
  resetStatusLineRender();
  clearStatusStackCacheForTest();

  await renderStatusStackAsync();
  marker("STACK_PINNED");

  const rl = readline.createInterface({ input, output });
  const terminal = new ReplTerminal(rl);

  const answer = await terminal.question(replPrompt());
  marker("PROMPT_DONE");

  terminal.appendUser(answer.trim());
  marker("USER_ECHOED");

  rl.close();
  marker("DONE");
}

async function runStatusDedup(): Promise<void> {
  resetStatusLineRender();
  clearStatusStackCacheForTest();

  const writes: string[] = [];
  const originalWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return originalWrite(chunk);
  }) as typeof process.stderr.write;

  try {
    await renderStatusStackAsync();
    const afterFirst = writes.length;
    await renderStatusStackAsync();
    const afterSecond = writes.length;
    marker(`WRITES_FIRST:${afterFirst}`);
    marker(`WRITES_SECOND:${afterSecond}`);

    const rl = readline.createInterface({ input, output });
    const terminal = new ReplTerminal(rl);

    beginAgentActivity();
    await terminal.question(replPrompt());
    endAgentActivity();
    marker("PROMPT_WITH_ACTIVITY");

    rl.close();
    marker("DONE");
  } finally {
    process.stderr.write = originalWrite;
  }
}

async function runFinalMessageOnly(): Promise<void> {
  resetStatusLineRender();
  clearStatusStackCacheForTest();

  const rl = readline.createInterface({ input, output });
  const terminal = new ReplTerminal(rl);

  beginAgentActivity();
  terminal.appendUser("table query");

  // Final-message-only path: message_start → message_end with no text_delta.
  terminal.prepareAssistantBlock();
  terminal.onAssistantEnd("| 1 | Sophie |");
  await terminal.flush();
  endAgentActivity();

  marker("ASSISTANT_DONE");
  rl.close();
  marker("DONE");
}

async function main(): Promise<void> {
  const mode = process.env.HARNESS_MODE ?? "prompt-echo";
  switch (mode) {
    case "prompt-echo":
      await runPromptEcho();
      break;
    case "status-dedup":
      await runStatusDedup();
      break;
    case "final-message-only":
      await runFinalMessageOnly();
      break;
    default:
      process.stderr.write(`unknown HARNESS_MODE: ${mode}\n`);
      process.exit(1);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
});
