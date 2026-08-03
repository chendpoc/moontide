import { emitFinalReply, emitUserPrompt } from "../events/conversation.js";
import { finalizeRunOutputs } from "../events/bus.js";
import { getRunId, resetRun } from "../events/run.js";

export interface RunHooks {
  onRunStart?(userPrompt: string): void;
  onRunEnd?(result: { reply: string; turn: number }): void;
}

export function createDefaultRunHooks(preparedRunId?: string): RunHooks {
  resetRun(preparedRunId);
  return {
    onRunStart(userPrompt) {
      emitUserPrompt(userPrompt);
    },
    onRunEnd(result) {
      emitFinalReply(result.turn, result.reply);
    },
  };
}

export function finalizeRunFromHooks(): void {
  finalizeRunOutputs(getRunId());
}
