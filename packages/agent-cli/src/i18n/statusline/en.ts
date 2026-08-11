import type { StatuslineCopy } from "./types.js";

export const statuslineEn: StatuslineCopy = {
  turnLabel: "turn",
  runLabel: "run",
  apiInLabel: "in",
  apiOutLabel: "out",
  tokenUnit: "tok",
  missing: "—",
  segmentLabels: {
    product: "product name",
    context: "context used/limit (pct)",
    turn: "turn number",
    model: "model id",
    workdir: "workspace path",
    run: "run id (short)",
    api_in: "last API input tokens",
    api_out: "last API output tokens",
  },
};
