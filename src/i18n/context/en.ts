import type { ContextCopy } from "./types.js";

export const contextCopyEn = {
  title: (turn, phase) => {
    const base = `CONTEXT · turn ${turn}`;
    if (phase === "pre") {
      return `${base} · pre-LLM`;
    }
    if (phase === "post") {
      return `${base} · post-LLM`;
    }
    return base;
  },
  window: "Window",
  billing: "API usage",
  change: "Change",
  input: "in",
  output: "out",
  billingDelta: (delta) => `· Δ ${delta}`,
  changeSinceLastTurn: (delta) => `${delta} since last turn`,
  exact: "exact",
  est: "est",
  tokUnit: "tok",
  compositionLabelPad: 18,
  compositionHeader: "Composition (estimated)",
  system: "system",
  toolDefs: "tool definitions",
  user: "user",
  assistant: "assistant",
  thinking: "thinking",
  toolResults: "tool results",
  messageCount: (count) => `${count} message${count === 1 ? "" : "s"}`,
  toolCallCount: (count) => `${count} tool call${count === 1 ? "" : "s"}`,
  compact: (mode, before, after, saved) =>
    `compact ${mode} ${before}→${after} (saved ${saved} tok)`,
  alert: (code, percent) =>
    code === "compaction_recommended"
      ? `Context at ${percent} — compaction recommended`
      : `Context at ${percent} — approaching limit`,
  inspectTurnSummary: (turn, tokenKind, tokens, limit, percent, headroom) =>
    `Turn ${turn} | ${tokenKind} ${tokens} / ${limit} tok (${percent}) | headroom ${headroom} tok`,
  inspectStructureLine: (count, toolCalls, delta) =>
    `messages=${count} tool_calls=${toolCalls} delta=${delta} tok`,
  inspectBreakdownHeader: "Breakdown:",
  inspectBreakdownSystem: "system",
  inspectBreakdownToolDefs: "tool_definitions",
  inspectBreakdownUser: "user",
  inspectBreakdownAssistant: "assistant",
  inspectBreakdownThinking: "thinking",
  inspectBreakdownToolResults: "tool_results",
  inspectBreakdownTotal: "total",
  inspectTierHeader: "Budget tiers (estimated):",
  inspectTierLine: (tier, used, limit, percent) => {
    const labels: Record<string, string> = {
      pinned: "L1 pinned",
      dialogue: "L2 dialogue",
      reference: "L3 reference",
      reserved: "L4 reserved",
      flex: "L5 flex",
    };
    const label = labels[tier] ?? tier;
    return `- ${label}: ${used} / ${limit} tok (${percent})`;
  },
  inspectTierWorkingSet: (used, limit) => `  └─ workingSet: ${used} / ${limit} tok`,
  tierLabel: (tier) => tier,
  inspectMessagesHeader: (count) => `messages[${count}]`,
  inspectUsageLine: (input, output) => `API usage: in=${input} tok out=${output} tok`,
} satisfies ContextCopy;
