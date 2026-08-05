import { PRODUCT_NAME } from "../../constants/brand.js";
import { ACTIVE_EVENTS_SUFFIX, DATA_DIR, RUNS_DIR } from "../../constants/storage.js";
import { loadStatusLineConfig } from "../../config/status-line.js";
import { ALL_STATUS_LINE_SEGMENT_IDS } from "./types.js";
import { renderStatusSegments, segmentLabel } from "./segments.js";
import type { StatusLineSegmentId, StatusSnapshot } from "./types.js";

export { renderStatusStack, renderStatusStackAsync, resetStatusStackRender } from "./render-stack.js";

/** Resident REPL / Cursor status line — segments only (see /statusline status for config). */
export function formatStatusLine(snapshot: StatusSnapshot): string {
  const config = loadStatusLineConfig();
  return renderStatusSegments(snapshot, config.segments);
}

/** @deprecated alias for formatStatusLine */
export function formatStatusLineVerbose(snapshot: StatusSnapshot): string {
  return formatStatusLine(snapshot);
}

/** Legend text for /help. */
export function formatStatusLineLegend(): string {
  return `Statusline: ${PRODUCT_NAME} · context · turn · model · workdir · /statusline · events → ${DATA_DIR}/${RUNS_DIR}/<runId>${ACTIVE_EVENTS_SUFFIX}`;
}

export function formatStatusLinePreview(snapshot: StatusSnapshot): string {
  return formatStatusLine(snapshot);
}

export function formatSegmentCatalog(active: StatusLineSegmentId[]): string {
  const activeSet = new Set(active);
  return ALL_STATUS_LINE_SEGMENT_IDS.map((id) => {
    const mark = activeSet.has(id) ? "[x]" : "[ ]";
    return `${mark} ${id} — ${segmentLabel(id)}`;
  }).join("\n");
}
