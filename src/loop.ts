import type { MessageParam } from "@anthropic-ai/sdk/resources/messages/messages.js";

import { resetSession } from "./context/sessions.js";
import { runHooks, setupDefaultHooks } from "./hooks.js";
import { chat, extractText } from "./llm.js";
import { buildSystemPrompt } from "./prompt.js";
import { TOOL_SCHEMAS, executeTool } from "./tools.js";

export async function agentLoop(messages: MessageParam[]): Promise<string> {
  setupDefaultHooks();
  const system = buildSystemPrompt();

  let turn = 0;
  while (true) {
    turn += 1;
    let beforeLLMContext = {
      turn, 
      messages,
      system,
      tools: TOOL_SCHEMAS,
    }
    runHooks("PreLLM", beforeLLMContext);
    
    const response = await chat(messages, TOOL_SCHEMAS, system);

    runHooks("PostLLM", { ...beforeLLMContext, response });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      runHooks("Stop", { messages });
      return extractText(response.content);
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

      const blocked = runHooks("PreToolUse", {
        tool_name: block.name,
        tool_input: block.input,
      });

      const output = blocked ?? (await executeTool(block.name, block.input as Record<string, unknown>));

      runHooks("PostToolUse", {
        tool_name: block.name,
        tool_input: block.input,
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
  resetSession();
  runHooks("UserPromptSubmit", { prompt: userPrompt });
  const messages: MessageParam[] = [{ role: "user", content: userPrompt }];
  return agentLoop(messages);
}
