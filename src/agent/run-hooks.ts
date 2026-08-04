import { emitFinalReply, emitUserPrompt } from "../log/conversation.js";
import { finalizeRunOutputs } from "../log/bus.js";
import { getRunId, resetRun } from "../log/run.js";

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
