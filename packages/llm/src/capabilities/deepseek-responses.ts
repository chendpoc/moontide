import type { AdapterCapabilityDeclaration } from "./types.js";

/** DeepSeek Responses API capability declarations (Phase 6 contract baseline). */
export const DEEPSEEK_RESPONSES_CAPABILITIES: AdapterCapabilityDeclaration[] = [
  {
    capability: "tool_choice.none",
    providerPresetId: "deepseek",
    adapterFamily: "openai-responses",
    status: "supported",
    contractTest: "llm-adapter-responses.contract",
  },
  {
    capability: "tool_choice.auto",
    providerPresetId: "deepseek",
    adapterFamily: "openai-responses",
    status: "supported",
    contractTest: "llm-adapter-responses.contract",
  },
  {
    capability: "tool_choice.required",
    providerPresetId: "deepseek",
    adapterFamily: "openai-responses",
    status: "supported",
    contractTest: "llm-adapter-responses.contract",
  },
  {
    capability: "parallel_tool_calls",
    providerPresetId: "deepseek",
    adapterFamily: "openai-responses",
    status: "ignored",
    notes: "DeepSeek Responses always parallel; parameter ignored",
  },
  {
    capability: "conversation.state",
    providerPresetId: "deepseek",
    adapterFamily: "openai-responses",
    status: "rejected",
    notes: "Stateless API; previous_response_id unsupported",
  },
];
