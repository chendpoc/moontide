import { registerWorkMemAgentPorts } from "../../../agent/ports/work-mem.js";
import { getWorkdir } from "../../../config.js";
import {
  appendWorkMemEvent,
  ensureWorkMemFile,
  readWorkMemEvents,
  resolveWorkingSetSnapshot,
  seedOutlineDraft,
} from "@moontide/tools";

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
      seedOutlineDraft(workdir, sessionId, workMemId, goal);
    },
    resolveWorkingSetSnapshot(input) {
      return resolveWorkingSetSnapshot({ ...input, workdir: getWorkdir() });
    },
    hasDecisionDraft({ sessionId, workMemId }) {
      const workdir = getWorkdir();
      const events = readWorkMemEvents(workdir, sessionId, workMemId);
      return events.some(
        (event) =>
          event.kind === "workmem_draft"
          && event.draftKind === "decision"
          && event.content.trim().length > 0,
      );
    },
  });
}

/** Test-only: allow re-register after reset. */
export function resetBuiltinWorkMemPortRegistration(): void {
  registered = false;
}
