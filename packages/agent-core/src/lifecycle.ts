import type { AgentMessage, Outcome, ToolResultMessage } from "@moontide/agent-common";
import type { RunEventBus } from "./run-event-bus.js";

export interface WithRunOptions {
  eventBus: RunEventBus;
  log: { messages: readonly AgentMessage[] };
  successOutcome?: () => Outcome;
}

export async function withRun<T>(
  options: WithRunOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const { eventBus, log, successOutcome } = options;
  eventBus.publish({ type: "run_start" });
  try {
    const result = await fn();
    eventBus.publish({
      type: "run_end",
      outcome: successOutcome?.() ?? { kind: "success", messages: log.messages },
    });
    return result;
  } catch (error) {
    if (error instanceof RunAbortError) {
      eventBus.publish({
        type: "run_end",
        outcome: { kind: "aborted", messages: log.messages },
      });
      throw error;
    }
    eventBus.publish({
      type: "run_end",
      outcome: {
        kind: "error",
        messages: log.messages,
        error: {
          code: "provider_error",
          message: error instanceof Error ? error.message : String(error),
          retryable: false,
        },
      },
    });
    throw error;
  }
}

export class RunAbortError extends Error {
  constructor(message = "Run aborted") {
    super(message);
    this.name = "RunAbortError";
  }
}

export interface TurnScope {
  finish(message: AgentMessage, toolResults: readonly ToolResultMessage[]): void;
}

export async function withTurn<T>(
  eventBus: RunEventBus,
  fn: (scope: TurnScope) => Promise<T>,
): Promise<T> {
  eventBus.publish({ type: "turn_start" });
  let turnMessage: AgentMessage = { role: "user", content: "" };
  let toolResults: readonly ToolResultMessage[] = [];
  const scope: TurnScope = {
    finish(message, results) {
      turnMessage = message;
      toolResults = results;
    },
  };
  try {
    return await fn(scope);
  } finally {
    eventBus.publish({ type: "turn_end", message: turnMessage, toolResults });
  }
}

export function publishMessageLifecycle(eventBus: RunEventBus, message: AgentMessage): void {
  eventBus.publish({ type: "message_start", message });
  eventBus.publish({ type: "message_end", message });
}

export function appendToLog(
  eventBus: RunEventBus,
  log: { append(message: AgentMessage): unknown[] },
  message: AgentMessage,
): void {
  for (const event of log.append(message)) {
    eventBus.publish(event as { type: "message_start" | "message_end"; message: AgentMessage });
  }
}
