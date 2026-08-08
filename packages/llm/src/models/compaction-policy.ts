/** Compaction projection policy. See docs/spec/context-composer.md §7. */

export type CompactionKind = "prune" | "tail_window" | "summary";

export interface CompactionPolicy {
  autoEnabled: boolean;
  thresholdPercent: number;
  keepTurns: number;
  defaultKind: CompactionKind;
  /** One-shot manual prune via `/compact prune`. */
  forcePrune?: boolean;
}

export const defaultCompactionPolicy: CompactionPolicy = {
  autoEnabled: true,
  thresholdPercent: 80,
  keepTurns: 4,
  defaultKind: "prune",
};
