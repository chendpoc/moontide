import type { Message, MessageParam, Tool } from "@anthropic-ai/sdk/resources/messages/messages.js";

import type { EventDraft } from "../../events/types.js";

export type ToolUseOutcome =
  | { status: "denied"; reason: string }
  | { status: "rejected"; reason: string }
  | { status: "succeeded"; output: string }
  | { status: "failed"; error: string };

export type LLMCallOutcome =
  | { status: "succeeded"; response: Message }
  | { status: "failed"; error: string };

export interface LLMCallRecord {
  turn: number;
  request: {
    messages: MessageParam[];
    system: string;
    tools: Tool[];
  };
  outcome: LLMCallOutcome;
}

export interface ToolUseRecord {
  turn: number;
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId: string;
  outcome: ToolUseOutcome;
}

export type PluginHookResult = {
  events?: void | EventDraft | EventDraft[];
  /** Extra text appended to the model-facing tool_result (observation plugins only). */
  modelAppend?: string;
};

export type PluginEvents = void | EventDraft | EventDraft[] | PluginHookResult;

export interface AgentPlugin {
  name: string;
  /** Hook name uses `LLM` in uppercase (`onLLMCall`, not `onLlmCall`). */
  onLLMCall?(record: LLMCallRecord): PluginEvents | Promise<PluginEvents>;
  onToolUse?(record: ToolUseRecord): PluginEvents | Promise<PluginEvents>;
}

export type PluginHook = "onLLMCall" | "onToolUse";

export interface PluginFailureRecord {
  plugin: string;
  hook: PluginHook;
  turn: number;
  runId: string;
  toolName?: string;
  toolUseId?: string;
  message: string;
  stack?: string;
}


