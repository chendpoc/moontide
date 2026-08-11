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
  await runtime.observers.dispatch("runStart", { userPrompt });
  try {
    const result = await fn();
    await runtime.observers.dispatch("runEnd", result);
    return result;
  } catch (error) {
    await runtime.observers.dispatch("runError", { error });
    throw error;
  } finally {
    await runtime.observers.dispatch("runFinalize", {});
  }
}
