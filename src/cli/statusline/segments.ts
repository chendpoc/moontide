import chalk from "chalk";

import { PRODUCT_NAME } from "../../constants/brand.js";
import { fmtNum } from "../../i18n/context/index.js";
import { formatContextSegment } from "./format-tokens.js";
import type { StatusLineSegmentId, StatusSnapshot } from "./types.js";

const themes = {
  dim: chalk.gray,
  context: chalk.cyan,
  product: chalk.bold,
};

type SegmentRenderer = (snapshot: StatusSnapshot) => string | null;

const SEGMENT_RENDERERS: Record<StatusLineSegmentId, SegmentRenderer> = {
  product: () => themes.product(PRODUCT_NAME),
  context: (snapshot) => {
    const segment = formatContextSegment(snapshot);
    return segment ? themes.context(segment) : themes.dim("—");
  },
  turn: (snapshot) => {
    const label = themes.dim("turn");
    if (snapshot.turn === null) {
      return `${label} ${themes.dim("—")}`;
    }
    return `${label} ${themes.dim(String(snapshot.turn))}`;
  },
  model: (snapshot) => themes.dim(snapshot.model),
  workdir: (snapshot) => themes.dim(snapshot.workdir),
  run: (snapshot) => {
    if (!snapshot.runId) {
      return null;
    }
    const short = snapshot.runId.length > 8 ? `${snapshot.runId.slice(0, 8)}…` : snapshot.runId;
    return themes.dim(`run ${short}`);
  },
  api_in: (snapshot) => {
    if (snapshot.lastApiIn === null) {
      return null;
    }
    return themes.dim(`in ${fmtNum(snapshot.lastApiIn)} tok`);
  },
  api_out: (snapshot) => {
    if (snapshot.lastApiOut === null) {
      return null;
    }
    return themes.dim(`out ${fmtNum(snapshot.lastApiOut)} tok`);
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
  const labels: Record<StatusLineSegmentId, string> = {
    product: "product name",
    context: "context used/limit (pct)",
    turn: "turn number",
    model: "model id",
    workdir: "workspace path",
    run: "run id (short)",
    api_in: "last API input tokens",
    api_out: "last API output tokens",
  };
  return labels[id];
}
