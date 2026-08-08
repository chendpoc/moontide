import chalk from "chalk";

import { PRODUCT_NAME } from "@moontide/shared/constants/brand.js";
import { fmtNum } from "../../i18n/context/index.js";
import { statuslineCopy } from "../../i18n/statusline/index.js";
import { formatContextSegment } from "./format-tokens.js";
import type { StatusLineSegmentId, StatusSnapshot } from "./types.js";

const themes = {
  dim: chalk.gray,
  context: chalk.cyan,
  product: chalk.bold,
};

type SegmentRenderer = (snapshot: StatusSnapshot) => string | null;

function segmentCopy() {
  return statuslineCopy();
}

const SEGMENT_RENDERERS: Record<StatusLineSegmentId, SegmentRenderer> = {
  product: () => themes.product(PRODUCT_NAME),
  context: (snapshot) => {
    const copy = segmentCopy();
    const segment = formatContextSegment(snapshot);
    return segment ? themes.context(segment) : themes.dim(copy.missing);
  },
  turn: (snapshot) => {
    const copy = segmentCopy();
    const label = themes.dim(copy.turnLabel);
    if (snapshot.turn === null) {
      return `${label} ${themes.dim(copy.missing)}`;
    }
    return `${label} ${themes.dim(String(snapshot.turn))}`;
  },
  model: (snapshot) => themes.dim(snapshot.model),
  workdir: (snapshot) => themes.dim(snapshot.workdir),
  run: (snapshot) => {
    if (!snapshot.runId) {
      return null;
    }
    const copy = segmentCopy();
    const short = snapshot.runId.length > 8 ? `${snapshot.runId.slice(0, 8)}…` : snapshot.runId;
    return themes.dim(`${copy.runLabel} ${short}`);
  },
  api_in: (snapshot) => {
    if (snapshot.lastApiIn === null) {
      return null;
    }
    const copy = segmentCopy();
    return themes.dim(`${copy.apiInLabel} ${fmtNum(snapshot.lastApiIn)} ${copy.tokenUnit}`);
  },
  api_out: (snapshot) => {
    if (snapshot.lastApiOut === null) {
      return null;
    }
    const copy = segmentCopy();
    return themes.dim(`${copy.apiOutLabel} ${fmtNum(snapshot.lastApiOut)} ${copy.tokenUnit}`);
  },
};

export function renderStatusSegments(
  snapshot: StatusSnapshot,
  segmentIds: StatusLineSegmentId[],
): string {
  const parts = segmentIds
    .map((id) => SEGMENT_RENDERERS[id](snapshot))
    .filter((part): part is string => part !== null && part.length > 0);

  return parts.join(themes.dim(" · "));
}

export function segmentLabel(id: StatusLineSegmentId): string {
  return statuslineCopy().segmentLabels[id];
}
