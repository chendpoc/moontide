import type { AdapterCapabilityDeclaration } from "./types.js";

/** DeepSeek Chat Completions capability declarations (spec layer). */
export const DEEPSEEK_CHAT_CAPABILITIES: AdapterCapabilityDeclaration[] = [
  {
    capability: "tool_choice.none",
    providerPresetId: "deepseek",
    adapterFamily: "openai-chat-completions",
    status: "supported",
    contractTest: "llm-adapter-chat.contract",
  },
  {
    capability: "tool_choice.auto",
    providerPresetId: "deepseek",
    adapterFamily: "openai-chat-completions",
    status: "supported",
    contractTest: "llm-adapter-chat.contract",
  },
  {
    capability: "tool_choice.required",
    providerPresetId: "deepseek",
    adapterFamily: "openai-chat-completions",
    status: "supported",
    contractTest: "llm-adapter-chat.contract",
  },
  {
    capability: "tool_choice.specified",
    providerPresetId: "deepseek",
    adapterFamily: "openai-chat-completions",
    status: "supported",
    contractTest: "llm-adapter-chat.contract",
  },
  {
    capability: "response_format.json_object",
    providerPresetId: "deepseek",
    adapterFamily: "openai-chat-completions",
    status: "supported",
    contractTest: "llm-adapter-chat.contract",
  },
  {
    capability: "thinking.disabled",
    providerPresetId: "deepseek",
    adapterFamily: "openai-chat-completions",
    status: "supported",
  },
  {
    capability: "reasoning_effort.low",
    providerPresetId: "deepseek",
    adapterFamily: "openai-chat-completions",
    status: "supported",
  },
  {
    capability: "reasoning_effort.medium",
    providerPresetId: "deepseek",
    adapterFamily: "openai-chat-completions",
    status: "emulated",
    notes: "DeepSeek coerces medium to high",
  },
  {
    capability: "reasoning_effort.high",
    providerPresetId: "deepseek",
    adapterFamily: "openai-chat-completions",
    status: "supported",
  },
];
