export const COMPACT_KEEP_TURNS_DEFAULT = 3;
export const COMPACT_THRESHOLD_DEFAULT = 85;
export const ARTIFACT_SPILL_THRESHOLD_BYTES_DEFAULT = 8192;
/** Default spill preview length as a fraction of inline/spill threshold (bytes → chars heuristic). */
export const ARTIFACT_SPILL_PREVIEW_RATIO = 0.2;

export function defaultToolPreviewChars(
  spillBytes: number = ARTIFACT_SPILL_THRESHOLD_BYTES_DEFAULT,
): number {
  return Math.floor(spillBytes * ARTIFACT_SPILL_PREVIEW_RATIO);
}

/** Derived default (~20% of {@link ARTIFACT_SPILL_THRESHOLD_BYTES_DEFAULT} → 1638). */
export const TOOL_PREVIEW_CHARS_DEFAULT = defaultToolPreviewChars();
export const CODE_REPL_DEFAULT_RUNTIME = "tsx";
export const CODE_REPL_TIMEOUT_MS_DEFAULT = 120_000;
export const TRACE_PREVIEW_CHARS_DEFAULT = 120;
