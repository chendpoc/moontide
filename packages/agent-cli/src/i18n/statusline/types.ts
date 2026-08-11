import type { StatusLineSegmentId } from "../../cli/statusline/types.js";

export interface StatuslineCopy {
  turnLabel: string;
  runLabel: string;
  apiInLabel: string;
  apiOutLabel: string;
  tokenUnit: string;
  missing: string;
  segmentLabels: Record<StatusLineSegmentId, string>;
}
