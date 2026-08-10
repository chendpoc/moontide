import type { AdapterCapabilityDeclaration } from "./types.js";

/**
 * DeepSeek Responses API (`POST https://api.deepseek.com/responses`).
 * Request body shape differs from Chat Completions and Anthropic Messages — normalize is separate.
 *
 * @see https://api-docs.deepseek.com/zh-cn/guides/responses_api
 * @see https://api-docs.deepseek.com/zh-cn/api/create-response
 */
export const DEEPSEEK_RESPONSES_CAPABILITIES: AdapterCapabilityDeclaration[] = [
  {
    capability: "model.deepseek-v4-flash",
    providerPresetId: "deepseek",
    adapterFamily: "openai-responses",
    status: "supported",
  },
  {
    capability: "model.deepseek-v4-pro",
    providerPresetId: "deepseek",
    adapterFamily: "openai-responses",
    status: "rejected",
    notes: "Responses API flash-only until pro support ships",
  },
  {
    capability: "max_output_tokens",
    providerPresetId: "deepseek",
    adapterFamily: "openai-responses",
    status: "supported",
    notes: "LLMRequest.maxTokens maps to max_output_tokens (not max_tokens)",
  },
  {
    capability: "reasoning_effort",
    providerPresetId: "deepseek",
    adapterFamily: "openai-responses",
    status: "supported",
    notes: "Normalize maps to API field reasoning.effort",
  },
  {
    capability: "reasoning.summary",
    providerPresetId: "deepseek",
    adapterFamily: "openai-responses",
    status: "ignored",
    notes: "Accepted but no summary generated",
  },
  {
    capability: "text.format.text",
    providerPresetId: "deepseek",
    adapterFamily: "openai-responses",
    status: "supported",
  },
  {
    capability: "text.format.json_schema",
    providerPresetId: "deepseek",
    adapterFamily: "openai-responses",
    status: "supported",
  },
  {
    capability: "text.verbosity",
    providerPresetId: "deepseek",
    adapterFamily: "openai-responses",
    status: "ignored",
  },
  {
    capability: "response_format.json_object",
    providerPresetId: "deepseek",
    adapterFamily: "openai-responses",
    status: "supported",
    notes: "Normalize maps to text.format.type=json_object",
  },
  {
    capability: "tool_choice.none",
    providerPresetId: "deepseek",
    adapterFamily: "openai-responses",
    status: "supported",
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
  },
  {
    capability: "tool_choice.specified",
    providerPresetId: "deepseek",
    adapterFamily: "openai-responses",
    status: "supported",
    notes: "Named function or web_search",
  },
  {
    capability: "tools.function",
    providerPresetId: "deepseek",
    adapterFamily: "openai-responses",
    status: "supported",
  },
  {
    capability: "tools.web_search",
    providerPresetId: "deepseek",
    adapterFamily: "openai-responses",
    status: "supported",
    notes: "Server-side execution",
  },
  {
    capability: "parallel_tool_calls",
    providerPresetId: "deepseek",
    adapterFamily: "openai-responses",
    status: "ignored",
    notes: "Always parallel; parameter ignored",
  },
  {
    capability: "max_tool_calls",
    providerPresetId: "deepseek",
    adapterFamily: "openai-responses",
    status: "ignored",
  },
  {
    capability: "stream",
    providerPresetId: "deepseek",
    adapterFamily: "openai-responses",
    status: "supported",
  },
  {
    capability: "temperature",
    providerPresetId: "deepseek",
    adapterFamily: "openai-responses",
    status: "supported",
    notes: "Range [0, 2]; ignored in thinking mode",
  },
  {
    capability: "top_p",
    providerPresetId: "deepseek",
    adapterFamily: "openai-responses",
    status: "supported",
    notes: "Ignored in thinking mode",
  },
  {
    capability: "top_logprobs",
    providerPresetId: "deepseek",
    adapterFamily: "openai-responses",
    status: "supported",
    notes: "Range [0, 20]",
  },
  {
    capability: "user",
    providerPresetId: "deepseek",
    adapterFamily: "openai-responses",
    status: "supported",
  },
  {
    capability: "count_tokens",
    providerPresetId: "deepseek",
    adapterFamily: "openai-responses",
    status: "rejected",
    notes: "No dedicated endpoint; DeepSeek uses Anthropic Messages count_tokens path",
  },
  {
    capability: "conversation.state",
    providerPresetId: "deepseek",
    adapterFamily: "openai-responses",
    status: "rejected",
    notes: "Stateless; previous_response_id and conversation unsupported",
  },
  {
    capability: "previous_response_id",
    providerPresetId: "deepseek",
    adapterFamily: "openai-responses",
    status: "rejected",
  },
  {
    capability: "store",
    providerPresetId: "deepseek",
    adapterFamily: "openai-responses",
    status: "rejected",
    notes: "Response always store: false",
  },
];
