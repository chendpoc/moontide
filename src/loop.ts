import type { MessageParam } from "@anthropic-ai/sdk/resources/messages/messages.js";

import { promptToolApproval } from "./cli/approval.js";
import { isCompactAutoEnabled } from "./cli/repl-session.js";
import { maybeAutoCompact } from "./context/compact.js";
import { resetSession } from "./context/sessions.js";
import { emitFinalReply, emitUserPrompt } from "./events/conversation.js";
import { runPhase } from "./events/orchestrator.js";
import { resetRun } from "./events/run.js";
import { setupEventPipeline } from "./events/setup.js";
import { runHooks, setupDefaultHooks, auditToolUse } from "./hooks.js";
import { chat, extractText } from "./llm.js";
import { checkPermission } from "./permissions.js";
import { buildSystemPrompt } from "./prompt.js";
import { TOOL_SCHEMAS, executeTool } from "./tools/index.js";

async function resolveToolOutput(
  turn: number,
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<string> {
  const hookBlocked = runHooks("PreToolUse", {
    turn,
    tool_name: toolName,
    tool_input: toolInput,
  });
  if (hookBlocked != null) {
    return hookBlocked;
  }

  const decision = checkPermission(toolName, toolInput);
  if (decision === "ask") {
    const approved = await promptToolApproval({ turn, toolName, toolInput });
    if (!approved) {
      return `Permission denied by user: ${toolName}`;
    }
  }

  auditToolUse({
    turn,
    tool_name: toolName,
    tool_input: toolInput,
  });

  return executeTool(toolName, toolInput);
}

export async function agentLoop(messages: MessageParam[]): Promise<{ reply: string; turn: number }> {
  setupDefaultHooks();
  const system = buildSystemPrompt();

  let turn = 0;
  while (true) {
    turn += 1;
    maybeAutoCompact(messages, system, TOOL_SCHEMAS, turn, isCompactAutoEnabled());

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
      runHooks("Stop", { messages });
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
      const output = await resolveToolOutput(turn, block.name, toolInput);

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
  runHooks("UserPromptSubmit", { prompt: userPrompt });

  const messages: MessageParam[] = [{ role: "user", content: userPrompt }];
  const { reply, turn } = await agentLoop(messages);

  emitFinalReply(turn, reply);
  return reply;
}

export async function continueReplAgent(
  userPrompt: string,
  messages: MessageParam[],
): Promise<{ reply: string; turn: number }> {
  resetRun();

  emitUserPrompt(userPrompt);
  runHooks("UserPromptSubmit", { prompt: userPrompt });

  messages.push({ role: "user", content: userPrompt });
  const result = await agentLoop(messages);

  emitFinalReply(result.turn, result.reply);
  return result;
}
