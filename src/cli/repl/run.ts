import readline from "node:readline/promises";
import { stdin as input, stderr as output } from "node:process";

import { continueReplAgent } from "../../agent/loop.js";
import type { AgentSession } from "../../agent/agent-session.js";
import { applyDeepPromptGate } from "../../agent/deep-mode.js";
import { getWorkdir } from "../../config.js";
import { PRODUCT_NAME } from "../../constants/brand.js";
import { bootstrapAgentPlatform, teardownAgentPlatform } from "../../app/bootstrap.js";
import { getAgentRuntime } from "../../agent/runtime/index.js";
import type { UserInteraction } from "../../tools/types.js";
import { reportError, toErrorRecord, toMessage } from "../../errors/index.js";
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
import { createReplSessionPersistenceDeps } from "../session-persistence-glue.js";
import { beginAgentActivity, endAgentActivity, renderStatusLineAsync } from "../statusline/render.js";
import { resolveReplLine } from "./dispatch.js";
import { createReplUserInteraction } from "./interaction.js";
import { getOrStartReplSession, getReplAgentSession, resetReplSession } from "./session.js";
import {
  autoSaveSession,
  printQuitHint,
  printStartupHint,
} from "../../plugins/builtin/session-persistence/index.js";

async function runAgentTurn(
  prompt: string,
  agentSession: AgentSession,
  userInteraction: UserInteraction,
): Promise<string> {
  beginAgentActivity();

  try {
    const { reply } = await continueReplAgent(prompt, agentSession, {
      userInteraction,
      session: agentSession.session,
      runtime: agentSession.runtime,
    });
    return reply;
  } catch (err) {
    reportError(toErrorRecord(err, "repl:runAgentTurn"));
    return toMessage(err);
  } finally {
    endAgentActivity();
  }
}

/** Interactive REPL loop (readline, slash commands, agent turns). */
export async function runRepl(): Promise<void> {
  await bootstrapAgentPlatform(getWorkdir(), getAgentRuntime());

  writeStderrLine(`${PRODUCT_NAME} — type /help for commands`);
  printStartupHint(getWorkdir());
  writeStderrLine("");

  // Prompt and statusline both use stderr so ANSI pin stays directly above `MoonTide >>`.
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
      await renderStatusLineAsync();
      const trimmed = (await rl.question(replPrompt())).trim();
      const action = await resolveReplLine(trimmed, ctx);

      if (action.kind === "exit") {
        break;
      }
      if (action.kind === "continue") {
        continue;
      }

      const agentSession = getOrStartReplSession();
      const gate = applyDeepPromptGate(action.prompt, agentSession.session.sessionId);
      if (gate.deepActivated) {
        getAgentRuntime().tools.refresh();
      }
      const reply = await runAgentTurn(gate.prompt, agentSession, userInteraction);
      if (turnCount > 0) {
        writeStderrLine(turnSeparator());
      }
      turnCount += 1;
      writeStdoutLine(reply);
      writeStdoutLine("");
    }
  } finally {
    const persistenceDeps = createReplSessionPersistenceDeps();
    autoSaveSession(persistenceDeps);
    printQuitHint(persistenceDeps);
    rl.close();
    resetReplSession();
    teardownAgentPlatform(getAgentRuntime());
  }
}
