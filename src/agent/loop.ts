import type { MessageParam } from "@anthropic-ai/sdk/resources/messages/messages.js";

import {
  createDefaultLoopContext,
  createToolContext,
  type LoopContext,
} from "./deps.js";
import { runHooks, setupDefaultHooks } from "./hooks.js";
import { buildSystemPrompt } from "./prompt.js";
import { TOOL_SCHEMAS, executeTool } from "./tools.js";
import { maybeAutoCompact } from "../context/compact.js";
import { resetSession } from "../context/sessions.js";
import { emitFinalReply, emitUserPrompt } from "../events/conversation.js";
import { runPhase } from "../events/orchestrator.js";
import { resetRun } from "../events/run.js";
import { setupEventPipeline } from "../events/setup.js";
import { chat, extractText } from "../llm.js";
import { checkPermission } from "../permission/index.js";

async function resolveToolOutput(
  turn: number,
  toolName: string,
  toolInput: Record<string, unknown>,
  loopCtx: LoopContext,
): Promise<string> {
  const hookBlocked = runHooks("PreToolUse", {
    turn,
    tool_name: toolName,
    tool_input: toolInput,
  });
  if (hookBlocked != null) {
    return hookBlocked;
  }

  if (checkPermission(toolName, toolInput) === "ask") {
    const approved = await loopCtx.userInteraction.approveTool({
      toolName,
      input: toolInput,
    });
    if (!approved) {
      return `Permission denied by user: ${toolName}`;
    }
  }

  return executeTool(toolName, toolInput, createToolContext(loopCtx));
}

export async function agentLoop(
  messages: MessageParam[],
  loopCtx: LoopContext = createDefaultLoopContext(),
): Promise<{ reply: string; turn: number }> {
  setupDefaultHooks();
  const system = buildSystemPrompt();

  let turn = 0;
  while (true) {
    turn += 1;
    maybeAutoCompact(messages, system, TOOL_SCHEMAS, turn, loopCtx.isCompactAutoEnabled());

    const beforeLLMContext = {
      turn,
      messages,
      system,
      tools: TOOL_SCHEMAS,
    };

    runPhase("pre_llm", beforeLLMContext);

    const response = await chat(messages, TOOL_SCHEMAS, system);

    runPhase("post_llm", { ...beforeLLMContext, response });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      runPhase("stop", { turn, messages, response });
      return { reply: extractText(response.content), turn };
    }

    const results: Array<{
      type: "tool_result";
      tool_use_id: string;
      content: string;
    }> = [];

    for (const block of response.content) {
      if (block.type !== "tool_use") {
        continue;
      }

      const toolInput = block.input as Record<string, unknown>;
      const output = await resolveToolOutput(turn, block.name, toolInput, loopCtx);

      runHooks("PostToolUse", {
        turn,
        tool_name: block.name,
        tool_input: block.input,
        tool_use_id: block.id,
        output,
      });

      runPhase("post_tool", {
        turn,
        tool_name: block.name,
        tool_input: block.input,
        tool_use_id: block.id,
        output,
      });

      results.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: output,
      });
    }

    messages.push({ role: "user", content: results });
  }
}

export async function runAgent(userPrompt: string): Promise<string> {
  setupEventPipeline();
  resetSession();
  resetRun();

  emitUserPrompt(userPrompt);

  const messages: MessageParam[] = [{ role: "user", content: userPrompt }];
  const { reply, turn } = await agentLoop(messages);

  emitFinalReply(turn, reply);
  return reply;
}

export async function continueReplAgent(
  userPrompt: string,
  messages: MessageParam[],
  loopCtx: LoopContext = createDefaultLoopContext(),
): Promise<{ reply: string; turn: number }> {
  resetRun();

  emitUserPrompt(userPrompt);

  messages.push({ role: "user", content: userPrompt });
  const result = await agentLoop(messages, loopCtx);

  emitFinalReply(result.turn, result.reply);
  return result;
}
