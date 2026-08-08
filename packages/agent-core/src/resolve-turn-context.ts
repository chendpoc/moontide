import type { AgentMessage, RunConfig, TurnCompileResult } from "@moontide/agent-common";

export async function resolveTurnContext(
  config: Readonly<RunConfig>,
  messages: readonly AgentMessage[],
  turn: number,
  signal?: AbortSignal,
): Promise<TurnCompileResult> {
  const transformed = config.transformContext
    ? await config.transformContext(messages, signal)
    : messages;

  if (config.compileTurnContext) {
    return config.compileTurnContext({ messages: transformed, turn }, signal);
  }

  if (!config.convertToLlm) {
    throw new Error("RunConfig requires compileTurnContext or convertToLlm");
  }

  const llmMessages = await config.convertToLlm(transformed);
  return { messages: llmMessages };
}
