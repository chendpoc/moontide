import type { ContextReport, DetailLevel } from "./types.js";

function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function getSummary(report: ContextReport): string {
  const tokenLabel = report.exactTokens ?? report.estimatedTokens;
  const tokenKind = report.exactTokens !== undefined ? "exact" : "est";
  return [
    `Turn ${report.turn} | ${tokenKind} ${formatNumber(tokenLabel)} / ${formatNumber(report.limit)} (${formatPercent(report.percentUsed)}) | headroom ${formatNumber(report.headroom)}`,
    `messages=${report.structure.messageCount} tool_calls=${report.structure.toolCallCount} delta=${formatNumber(report.trend.deltaTokens)}`,
    report.alerts.length > 0 ? report.alerts.map((alert) => alert.message).join("; ") : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function getStruct(report: ContextReport): string {
  const lines = [
    getSummary(report),
    `├─ system          ${formatNumber(report.breakdown.system)} tok`,
    `├─ tool_schemas    ${formatNumber(report.breakdown.toolSchemas)} tok`,
    `└─ messages[${report.structure.messageCount}]`,
  ];

  for (const [idx, line] of report.messageLines.entries()) {
    const prefix = idx === report.messageLines.length - 1 ? "   └─" : "   ├─";
    lines.push(
      `${prefix} [${line.index}] ${line.role.padEnd(9)} ${formatNumber(line.tokens).padStart(6)} tok  ${line.label}  "${line.preview}"`,
    );
  }

  return lines.join("\n");
}

export function getBreakdown(report: ContextReport): string {
  const { breakdown: b } = report;
  return [
    getSummary(report),
    "",
    "Breakdown:",
    `- system:       ${formatNumber(b.system)}`,
    `- tool_schemas: ${formatNumber(b.toolSchemas)}`,
    `- user:         ${formatNumber(b.user)}`,
    `- assistant:    ${formatNumber(b.assistant)}`,
    `- thinking:     ${formatNumber(b.thinking)}`,
    `- tool_results: ${formatNumber(b.toolResults)}`,
    `- total:        ${formatNumber(b.total)}`,
  ].join("\n");
}

export function getFull(report: ContextReport): string {
  const usageLine =
    report.usage?.inputTokens !== undefined
      ? `\nUsage: input=${formatNumber(report.usage.inputTokens)} output=${formatNumber(report.usage.outputTokens ?? 0)}`
      : "";

  return `${getBreakdown(report)}${usageLine}\n\n${getStruct(report)}`;
}

export function formatContext(report: ContextReport, detailLevel: DetailLevel = "summary"): string {
  switch (detailLevel) {
    case "summary":
      return getSummary(report);
    case "struct":
      return getStruct(report);
    case "breakdown":
      return getBreakdown(report);
    case "full":
      return getFull(report);
  }
}
