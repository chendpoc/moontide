import { registerWorkMemAgentPorts } from "../../../agent/ports/work-mem.js";

import { resolveWorkingSetSnapshot } from "./escalation.js";
import { appendWorkMemEvent, ensureWorkMemFile } from "./store.js";

let registered = false;

/** Wire work_mem persistence + budget escalation into agent ports (idempotent). */
export function registerBuiltinWorkMemPorts(): void {
  if (registered) {
    return;
  }
  registered = true;

  registerWorkMemAgentPorts({
    startDeepTaskRecord({ workdir, sessionId, workMemId, goal }) {
      ensureWorkMemFile(workdir, sessionId, workMemId);
      appendWorkMemEvent(workdir, sessionId, workMemId, {
        kind: "workmem_started",
        workMemId,
        ts: new Date().toISOString(),
        goal,
      });
    },
    resolveWorkingSetSnapshot(input) {
      return resolveWorkingSetSnapshot(input);
    },
  });
}

/** Test-only: allow re-register after reset. */
export function resetBuiltinWorkMemPortRegistration(): void {
  registered = false;
}
