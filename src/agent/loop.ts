import type { MessageParam } from "@anthropic-ai/sdk/resources/messages/messages.js";

import { computeAutoCompact } from "../context/compact.js";
import { emitCompactEvent } from "../context/compact-events.js";
import { resetSession } from "../context/sessions.js";
import { emitFinalReply, emitUserPrompt } from "../events/conversation.js";
import { finalizeRunOutputs } from "../events/bus.js";
import { resetRun } from "../events/run.js";
import { setupEventPipeline } from "../events/setup.js";
import { extractText } from "../llm/client/anthropic.js";
import {
  createDefaultLoopContext,
  type LoopContext,
} from "./deps.js";
import { buildSystemPrompt } from "./prompt.js";
import { toolSchemas } from "./tools/index.js";
import { runLLM } from "./pipeline/runLLM.js";
import { runToolUses } from "./pipeline/runTool.js";

export async function agentLoop(
  messages: MessageParam[],
  loopCtx: LoopContext = createDefaultLoopContext(),
): Promise<{ reply: string; turn: number }> {
  const system = buildSystemPrompt();

  let turn = 0;
  while (true) {
    turn += 1;

    const compactResult = computeAutoCompact(
      messages,
      system,
      toolSchemas(),
      loopCtx.isCompactAutoEnabled(),
    );
    if (compactResult) {
      messages.splice(0, messages.length, ...compactResult.messages);
      emitCompactEvent(turn, compactResult, "auto");
    }

    const response = await runLLM({
      turn,
      messages,
      system,
      tools: toolSchemas(),
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      return { reply: extractText(response.content), turn };
    }

    messages.push({
      role: "user",
      content: await runToolUses(turn, response.content, loopCtx),
    });
  }
}

export async function runAgent(userPrompt: string): Promise<string> {
  setupEventPipeline();
  resetSession();
  const runId = resetRun();

  emitUserPrompt(userPrompt);

  try {
    const messages: MessageParam[] = [{ role: "user", content: userPrompt }];
    const { reply, turn } = await agentLoop(messages);
    emitFinalReply(turn, reply);
    return reply;
  } finally {
    finalizeRunOutputs(runId);
  }
}

export async function continueReplAgent(
  userPrompt: string,
  messages: MessageParam[],
  loopCtx: LoopContext = createDefaultLoopContext(),
  preparedRunId?: string,
): Promise<{ reply: string; turn: number }> {
  const runId = resetRun(preparedRunId);

  emitUserPrompt(userPrompt);

  try {
    messages.push({ role: "user", content: userPrompt });
    const result = await agentLoop(messages, loopCtx);
    emitFinalReply(result.turn, result.reply);
    return result;
  } finally {
    finalizeRunOutputs(runId);
  }
}
