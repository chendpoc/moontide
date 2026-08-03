import type { CompactionKind } from "../../../session/log-types.js";

/** Compaction projection policy. See docs/spec/context-composer.md §7. */
export interface CompactionPolicy {
  autoEnabled: boolean;
  thresholdPercent: number;
  keepTurns: number;
  defaultKind: CompactionKind;
}

export const defaultCompactionPolicy: CompactionPolicy = {
  autoEnabled: true,
  thresholdPercent: 80,
  keepTurns: 4,
  defaultKind: "prune",
};
