import readline from "node:readline/promises";
import { stdin as input, stderr as output } from "node:process";

import {
  applyDeepPromptGate,
  autoSaveSession,
  bootstrapAgentPlatform,
  continueReplAgent,
  getAgentRuntime,
  getWorkdir,
  setupToolsPorts,
  teardownAgentPlatform,
  type AgentSession,
} from "@moontide/agent";
import { PRODUCT_NAME } from "@moontide/shared/constants/brand.js";
import { createCliEventOutputs } from "../../log/cli-event-outputs.js";
import { printQuitHint, printStartupHint } from "../session-hints.js";
import type { UserInteraction } from "@moontide/tools";
import { reportError, toErrorRecord, toMessage } from "../../errors/index.js";
import { replPrompt, writeStderrLine } from "../../terminal/index.js";
import {
  resetReplConversation,
  type ReplCommandContext,
} from "../commands/repl.js";
import { createReplSessionLifecycleAccess } from "../session-persistence-glue.js";
import { beginAgentActivity, endAgentActivity } from "../statusline/render.js";
import { resolveReplLine } from "./dispatch.js";
import { createReplUserInteraction } from "./interaction.js";
import { createReplRunEventProjection } from "./run-event-projection.js";
import { getOrStartReplSession, getReplAgentSession, resetReplSession } from "./session.js";
import { ReplTerminal } from "./terminal.js";

async function runAgentTurn(
  prompt: string,
  agentSession: AgentSession,
  userInteraction: UserInteraction,
  terminal: ReplTerminal,
): Promise<void> {
  beginAgentActivity();
  const projection = createReplRunEventProjection(terminal);

  try {
    const { reply } = await continueReplAgent(
      prompt,
      agentSession,
      {
        userInteraction,
        session: agentSession.session,
        runtime: agentSession.runtime,
      },
      undefined,
      { extraRunEventListeners: [projection.listener] },
    );
    await terminal.flush();
    if (!projection.hadOutput() && reply.length > 0) {
      terminal.appendAssistantFallback(reply);
    }
    await terminal.flush();
  } catch (err) {
    reportError(toErrorRecord(err, "repl:runAgentTurn"));
    const message = toMessage(err);
    if (message.length > 0) {
      terminal.appendAssistantFallback(message);
    }
    await terminal.flush();
  } finally {
    endAgentActivity();
    projection.resetHadOutput();
  }
}

/** Interactive REPL loop (readline, slash commands, agent turns). */
export async function runRepl(): Promise<void> {
  setupToolsPorts();
  const runtime = getAgentRuntime();
  const workdir = getWorkdir();
  await bootstrapAgentPlatform({
    workdir,
    runtime,
    eventOutputs: createCliEventOutputs(workdir),
  });

  writeStderrLine(`${PRODUCT_NAME} — type /help for commands`);
  printStartupHint(workdir);
  writeStderrLine("");

  getOrStartReplSession();

  const rl = readline.createInterface({ input, output });
  const terminal = new ReplTerminal(rl);
  const userInteraction = createReplUserInteraction(terminal);
  let turnCount = 0;

  const ctx: ReplCommandContext = {
    rl,
    getAgentSession: () => getReplAgentSession(),
    resetConversation: () => {
      resetReplConversation();
      terminal.resetTranscriptState();
      turnCount = 0;
    },
  };

  try {
    while (true) {
      const line = await terminal.question(replPrompt());
      const trimmed = line.trim();
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

      if (turnCount > 0) {
        terminal.appendTurnSeparator();
      }
      turnCount += 1;
      terminal.appendUser(action.prompt);

      await runAgentTurn(gate.prompt, agentSession, userInteraction, terminal);
    }
  } finally {
    const lifecycleAccess = createReplSessionLifecycleAccess();
    autoSaveSession(lifecycleAccess);
    printQuitHint(lifecycleAccess);
    rl.close();
    resetReplSession();
    teardownAgentPlatform(getAgentRuntime());
  }
}
