import type { StatuslineCopy } from "./types.js";

export const statuslineZh: StatuslineCopy = {
  turnLabel: "轮次",
  runLabel: "运行",
  apiInLabel: "入",
  apiOutLabel: "出",
  tokenUnit: "tok",
  missing: "—",
  segmentLabels: {
    product: "产品名",
    context: "上下文用量/上限",
    turn: "轮次",
    model: "模型",
    workdir: "工作目录",
    run: "运行 ID（短）",
    api_in: "上次 API 输入 token",
    api_out: "上次 API 输出 token",
  },
};
