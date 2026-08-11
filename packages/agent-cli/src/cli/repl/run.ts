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
import { createCliEventPipeline } from "../../log/cli-event-pipeline.js";
import { printQuitHint, printStartupHint } from "../session-hints.js";
import { createReplConversationStreamListener } from "../../log/repl-conversation-stream.js";
import type { UserInteraction } from "@moontide/tools";
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
import { createReplSessionLifecycleAccess } from "../session-persistence-glue.js";
import { beginAgentActivity, endAgentActivity, renderStatusLineAsync } from "../statusline/render.js";
import { resolveReplLine } from "./dispatch.js";
import { createReplUserInteraction } from "./interaction.js";
import { getOrStartReplSession, getReplAgentSession, resetReplSession } from "./session.js";

async function runAgentTurn(
  prompt: string,
  agentSession: AgentSession,
  userInteraction: UserInteraction,
): Promise<{ reply: string; streamed: boolean }> {
  beginAgentActivity();

  try {
    const stream = createReplConversationStreamListener({
      onText: (text) => {
        writeStdoutLine(text);
        writeStdoutLine("");
      },
    });
    const { reply } = await continueReplAgent(
      prompt,
      agentSession,
      {
        userInteraction,
        session: agentSession.session,
        runtime: agentSession.runtime,
      },
      undefined,
      { extraRunEventListeners: [stream.listener] },
    );
    return { reply, streamed: stream.hadOutput() };
  } catch (err) {
    reportError(toErrorRecord(err, "repl:runAgentTurn"));
    return { reply: toMessage(err), streamed: false };
  } finally {
    endAgentActivity();
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
    pipeline: createCliEventPipeline(workdir),
  });

  writeStderrLine(`${PRODUCT_NAME} — type /help for commands`);
  printStartupHint(workdir);
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
      const { reply, streamed } = await runAgentTurn(gate.prompt, agentSession, userInteraction);
      if (turnCount > 0) {
        writeStderrLine(turnSeparator());
      }
      turnCount += 1;
      if (!streamed && reply.length > 0) {
        writeStdoutLine(reply);
        writeStdoutLine("");
      }
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
