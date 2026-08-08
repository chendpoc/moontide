import type { AgentRuntime } from "./runtime/index.js";

export interface AgentRunResult {
  reply: string;
  turn: number;
}

export async function withRun<T extends AgentRunResult>(
  runtime: AgentRuntime,
  userPrompt: string,
  fn: () => Promise<T>,
): Promise<T> {
  await runtime.hooks.dispatch("runStart", { userPrompt });
  try {
    const result = await fn();
    await runtime.hooks.dispatch("runEnd", result);
    return result;
  } catch (error) {
    await runtime.hooks.dispatch("runError", { error });
    throw error;
  } finally {
    await runtime.hooks.dispatch("runFinalize", {});
  }
}

export async function withTurn<T>(
  runtime: AgentRuntime,
  turn: number,
  fn: () => Promise<T>,
): Promise<T> {
  await runtime.hooks.dispatch("turnStart", { turn });
  try {
    return await fn();
  } finally {
    await runtime.hooks.dispatch("turnEnd", { turn });
  }
}
