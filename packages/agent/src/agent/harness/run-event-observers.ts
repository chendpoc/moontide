import type { RunEvent } from "@moontide/run-protocol";
import type { RunEventListener } from "@moontide/agent-core";

import type { AgentRuntime } from "../runtime/index.js";

/** RunEvent bus listeners that forward turn events to run observers. */
export function createHarnessRunEventObservers(runtime: AgentRuntime): RunEventListener {
  let turn = 0;

  return (event: RunEvent) => {
    if (event.type === "turn_start") {
      turn += 1;
      void runtime.observers.dispatch("turnStart", { turn });
      return;
    }
    if (event.type === "turn_end") {
      void runtime.observers.dispatch("turnEnd", { turn });
    }
  };
}
