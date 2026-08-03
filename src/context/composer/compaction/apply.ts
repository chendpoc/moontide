import type { SessionLog } from "../../../session/log-types.js";
import type { CompactionRecord } from "../../stores/compaction-types.js";
import type { CompactionPolicy } from "./policy.js";

export interface CompactionApplyInput {
  log: SessionLog[];
  policy: CompactionPolicy;
  activeRecord?: CompactionRecord;
}

/** Apply compaction policy to session log projection (C1b stub). */
export function applyCompactionPolicy(input: CompactionApplyInput): SessionLog[] {
  return input.log;
}
