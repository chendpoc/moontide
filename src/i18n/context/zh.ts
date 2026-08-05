import type { ContextCopy } from "./types.js";

export const contextCopyZh = {
  title: (turn, phase) => {
    const base = `上下文 · 第 ${turn} 轮`;
    if (phase === "pre") {
      return `${base} · 请求前`;
    }
    if (phase === "post") {
      return `${base} · 请求后`;
    }
    return base;
  },
  window: "窗口",
  billing: "API 计费",
  change: "变化",
  input: "输入",
  output: "输出",
  billingDelta: (delta) => `· 较上轮 ${delta}`,
  changeSinceLastTurn: (delta) => `较上轮 ${delta}`,
  exact: "精确",
  est: "估算",
  tokUnit: "tok",
  compositionLabelPad: 8,
  compositionHeader: "组成（估算）",
  system: "系统",
  toolDefs: "工具定义",
  user: "用户",
  assistant: "助手",
  thinking: "思考",
  toolResults: "工具结果",
  messageCount: (count) => `${count} 条消息`,
  toolCallCount: (count) => `${count} 次工具调用`,
  compact: (mode, before, after, saved) =>
    `压缩 ${mode} ${before}→${after}（节省 ${saved} tok）`,
  alert: (code, percent) =>
    code === "compaction_recommended"
      ? `上下文占用 ${percent} — 建议压缩`
      : `上下文占用 ${percent} — 接近上限`,
  inspectTurnSummary: (turn, tokenKind, tokens, limit, percent, headroom) =>
    `第 ${turn} 轮 | ${tokenKind} ${tokens} / ${limit} tok（${percent}）| 剩余 ${headroom} tok`,
  inspectStructureLine: (count, toolCalls, delta) =>
    `messages=${count} tool_calls=${toolCalls} delta=${delta} tok`,
  inspectBreakdownHeader: "分解：",
  inspectBreakdownSystem: "system",
  inspectBreakdownToolDefs: "tool_definitions",
  inspectBreakdownUser: "user",
  inspectBreakdownAssistant: "assistant",
  inspectBreakdownThinking: "thinking",
  inspectBreakdownToolResults: "tool_results",
  inspectBreakdownTotal: "合计",
  inspectTierHeader: "分账层级（估算）：",
  inspectTierLine: (tier, used, limit, percent) => {
    const labels: Record<string, string> = {
      pinned: "L1 固定",
      dialogue: "L2 对话",
      reference: "L3 引用",
      reserved: "L4 预留",
      flex: "L5 弹性",
    };
    const label = labels[tier] ?? tier;
    return `- ${label}: ${used} / ${limit} tok（${percent}）`;
  },
  inspectTierWorkingSet: (used, limit) => `  └─ workingSet: ${used} / ${limit} tok`,
  tierLabel: (tier) => {
    const labels: Record<string, string> = {
      pinned: "L1 固定",
      dialogue: "L2 对话",
      reference: "L3 引用",
      reserved: "L4 预留",
      flex: "L5 弹性",
    };
    return labels[tier] ?? tier;
  },
  inspectMessagesHeader: (count) => `messages[${count}]`,
  inspectUsageLine: (input, output) => `API 计费: 输入=${input} tok 输出=${output} tok`,
} satisfies ContextCopy;
