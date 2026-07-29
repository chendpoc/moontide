import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import chalk from "chalk";

import { setToolApprovalPrompt } from "./cli/approval.js";
import {
  handleReplCommand,
  resetReplConversation,
  type ReplCommandContext,
} from "./cli/repl-commands.js";
import { hasReplSession, getReplMessages, resetReplSession, startReplSession } from "./cli/repl-session.js";
import { renderStatusLine } from "./cli/statusline/render.js";
import { setReplPhase } from "./cli/statusline/collect.js";
import { resetSession } from "./context/sessions.js";
import {
  isEventsMode,
  setCliEventsArgv,
} from "./events/cli-session.js";
import { setupEventPipeline } from "./events/setup.js";
import { continueReplAgent } from "./loop.js";

const SEPARATOR = chalk.gray("─".repeat(48));
let turnCount = 0;

async function main(): Promise<void> {
  const eventsFlag = process.argv.slice(2).includes("--events");
  setCliEventsArgv(eventsFlag);
  setupEventPipeline();

  console.error("Oculeau — type /help for commands\n");

  const rl = readline.createInterface({ input, output });

  const ctx: ReplCommandContext = {
    rl,
    getMessages: () => getReplMessages(),
    resetConversation: () => {
      resetReplConversation();
      turnCount = 0;
    },
  };

  setToolApprovalPrompt(async ({ toolName, toolInput }) => {
    const preview = JSON.stringify(toolInput).slice(0, 80);
    const answer = await rl.question(
      `\x1b[33mAllow ${toolName}? ${preview} [y/N]\x1b[0m `,
    );
    return ["y", "yes"].includes(answer.trim().toLowerCase());
  });

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

      setReplPhase("running");
      renderStatusLine();

      const { reply } = await continueReplAgent(trimmed, messages);

      setReplPhase("idle");
      renderStatusLine();

      if (!isEventsMode()) {
        if (turnCount > 0) {
          console.error(SEPARATOR);
        }
        turnCount += 1;
        console.log(reply);
        console.log();
      }
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
