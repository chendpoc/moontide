import { randomBytes } from "node:crypto";

import { appendWorkMemEvent } from "./store.js";

export function buildOutlineSeedContent(goal: string): string {
  return [
    "# Task outline",
    `Goal: ${goal}`,
    "",
    "## Open questions",
    "- (to be filled during investigation)",
    "",
    "## Planned steps",
    "- (to be filled)",
  ].join("\n");
}

/** Deterministic outline draft appended when a deep task starts (no LLM). */
export function seedOutlineDraft(
  workdir: string,
  sessionId: string,
  workMemId: string,
  goal: string,
): void {
  appendWorkMemEvent(workdir, sessionId, workMemId, {
    kind: "workmem_draft",
    entryId: randomBytes(4).toString("hex"),
    ts: new Date().toISOString(),
    draftKind: "outline",
    content: buildOutlineSeedContent(goal),
  });
}
