import chalk from "chalk";

import { PRODUCT_NAME } from "../../constants/brand.js";
import { ACTIVE_EVENTS_SUFFIX, DATA_DIR, RUNS_DIR } from "../../constants/storage.js";
import { loadStatusLineConfig } from "../../config/status-line.js";
import { ALL_STATUS_LINE_SEGMENT_IDS } from "./types.js";
import { renderStatusSegments, segmentLabel } from "./segments.js";
import type { StatusLineSegmentId, StatusSnapshot } from "./types.js";
import { formatContextSegment } from "./format-tokens.js";

export { renderStatusStack, renderStatusStackAsync, resetStatusStackRender } from "./render-stack.js";

/** Full status for /status. */
export function formatStatusLineVerbose(snapshot: StatusSnapshot): string {
  const config = loadStatusLineConfig();
  const contextDetail = formatContextSegment(snapshot) ?? "—";

  return [
    renderStatusSegments(snapshot, config.segments),
    chalk.dim(`model ${snapshot.model}`),
    chalk.dim(`workdir ${snapshot.workdir}`),
    chalk.cyan(`context ${contextDetail}`),
    chalk.dim(snapshot.turn !== null ? `turn ${snapshot.turn}` : "turn —"),
    chalk.dim(`segments ${config.segments.join(", ")}`),
    config.command ? chalk.dim(`command ${config.command}`) : "",
  ]
    .filter(Boolean)
    .join(chalk.dim(" · "));
}

/** Legend text for /help. */
export function formatStatusLineLegend(): string {
  return `Statusline: ${PRODUCT_NAME} · context · turn · model · workdir · segments · /statusline · events → ${DATA_DIR}/${RUNS_DIR}/<runId>${ACTIVE_EVENTS_SUFFIX}`;
}

export function formatStatusLinePreview(snapshot: StatusSnapshot): string {
  const config = loadStatusLineConfig();
  return renderStatusSegments(snapshot, config.segments);
}

export function formatSegmentCatalog(active: StatusLineSegmentId[]): string {
  const activeSet = new Set(active);
  return ALL_STATUS_LINE_SEGMENT_IDS.map((id) => {
    const mark = activeSet.has(id) ? "[x]" : "[ ]";
    return `${mark} ${id} — ${segmentLabel(id)}`;
  }).join("\n");
}

/** Built-in resident status line (segment config + model/workdir/context meta). */
export function formatStatusLine(snapshot: StatusSnapshot): string {
  return formatStatusLineVerbose(snapshot);
}
