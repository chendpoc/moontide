import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { continueReplAgent } from "../../agent/loop.js";
import type { AgentSession } from "../../agent/agent-session.js";
import { setupEventPipeline } from "../../log/setup.js";
import type { UserInteraction } from "../../tools/types.js";
import {
  replPrompt,
  turnSeparator,
  writeStderrLine,
  writeStdoutLine,
} from "../../terminal/index.js";
import {
  resetReplConversation,
  type ReplCommandContext,
} from "../commands/repl.js";
import { setReplPhase } from "../statusline/collect.js";
import { renderStatusLine } from "../statusline/render.js";
import { resolveReplLine } from "./dispatch.js";
import { createReplUserInteraction } from "./interaction.js";
import { getOrStartReplSession, getReplAgentSession, resetReplSession } from "./session.js";

async function runAgentTurn(
  prompt: string,
  agentSession: AgentSession,
  userInteraction: UserInteraction,
): Promise<string> {
  setReplPhase("running");
  renderStatusLine();

  try {
    const { reply } = await continueReplAgent(prompt, agentSession, {
      userInteraction,
      session: agentSession.session,
    });
    return reply;
  } finally {
    setReplPhase("idle");
    renderStatusLine();
  }
}

/** Interactive REPL loop (readline, slash commands, agent turns). */
export async function runRepl(): Promise<void> {
  setupEventPipeline();

  writeStderrLine("Ocula — type /help for commands");
  writeStderrLine("");

  const rl = readline.createInterface({ input, output });
  const userInteraction = createReplUserInteraction(rl);
  let turnCount = 0;

  const ctx: ReplCommandContext = {
    rl,
    getAgentSession: () => getReplAgentSession(),
    resetConversation: () => {
      resetReplConversation();
      turnCount = 0;
    },
  };

  try {
    while (true) {
      renderStatusLine();
      const trimmed = (await rl.question(replPrompt())).trim();
      const action = await resolveReplLine(trimmed, ctx);

      if (action.kind === "exit") {
        break;
      }
      if (action.kind === "continue") {
        continue;
      }

      const agentSession = getOrStartReplSession();
      const reply = await runAgentTurn(action.prompt, agentSession, userInteraction);
      if (turnCount > 0) {
        writeStderrLine(turnSeparator());
      }
      turnCount += 1;
      writeStdoutLine(reply);
      writeStdoutLine("");
    }
  } finally {
    rl.close();
    resetReplSession();
  }
}
