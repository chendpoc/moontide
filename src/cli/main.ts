import "../bootstrap.js";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import chalk from "chalk";

import { continueReplAgent } from "../agent/loop.js";
import { resetSession } from "../context/sessions.js";
import { resetRun } from "../events/run.js";
import { setupEventPipeline } from "../events/setup.js";
import {
  handleReplCommand,
  resetReplConversation,
  type ReplCommandContext,
} from "./commands/repl.js";
import { createReplLoopContext } from "./repl/interaction.js";
import {
  getReplMessages,
  hasReplSession,
  resetReplSession,
  startReplSession,
} from "./repl/session.js";
import { setReplPhase } from "./statusline/collect.js";
import { renderStatusLine } from "./statusline/render.js";

const SEPARATOR = chalk.gray("─".repeat(48));
let turnCount = 0;

async function main(): Promise<void> {
  setupEventPipeline();

  console.error("Oculeau — type /help for commands\n");

  const rl = readline.createInterface({ input, output });
  const loopCtx = createReplLoopContext(rl);

  const ctx: ReplCommandContext = {
    rl,
    getMessages: () => getReplMessages(),
    resetConversation: () => {
      resetReplConversation();
      turnCount = 0;
    },
  };

  try {
    while (true) {
      renderStatusLine();
      const query = await rl.question("\x1b[36mOculeau >> \x1b[0m");
      const trimmed = query.trim();
      if (!trimmed || ["q", "exit"].includes(trimmed.toLowerCase())) {
        break;
      }

      if (trimmed.startsWith("/")) {
        const result = await handleReplCommand(trimmed, ctx);
        if (result === "handled") {
          continue;
        }
        if (result === "unknown") {
          console.error(`unknown command: ${trimmed.split(/\s+/)[0]} (try /help)`);
          continue;
        }
      }

      if (!hasReplSession()) {
        resetSession();
        startReplSession();
      }

      const messages = ctx.getMessages();
      if (!messages) {
        continue;
      }

      const runId = resetRun();
      setReplPhase("running");
      renderStatusLine();

      let reply: string;
      try {
        ({ reply } = await continueReplAgent(trimmed, messages, loopCtx, runId));
      } finally {
        setReplPhase("idle");
        renderStatusLine();
      }

      if (turnCount > 0) {
        console.error(SEPARATOR);
      }
      turnCount += 1;
      console.log(reply);
      console.log();
    }
  } finally {
    rl.close();
    resetReplSession();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
