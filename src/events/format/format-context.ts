import chalk from "chalk";

import { contextVerbose } from "../../config.js";
import type { ContextReport } from "../../context/types.js";
import type { AgentEvent } from "../types.js";
import { boxLine, fmt, padTurn } from "./shared.js";

const BOX_WIDTH = 44;
const theme = {
  label: chalk.bgCyan.black.bold,
  border: chalk.cyan.dim,
  key: chalk.cyan,
  value: chalk.white,
  warn: chalk.yellow,
  critical: chalk.red.bold,
  barFill: chalk.cyan,
  barEmpty: chalk.gray,
};

function tokenBar(percent: number, width = 28): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * width);
  return theme.barFill("█".repeat(filled)) + theme.barEmpty("░".repeat(width - filled));
}

function boxTop(title: string): string {
  const label = ` ${title} `;
  const dashCount = Math.max(2, BOX_WIDTH + 2 - label.length);
  return theme.border(`┌${label}${"─".repeat(dashCount)}┐`);
}

function boxBottom(): string {
  return theme.border(`└${"─".repeat(BOX_WIDTH + 2)}┘`);
}

function formatBreakdown(report: ContextReport): string[] {
  const { breakdown } = report;
  return [
    boxLine(`system ${fmt(breakdown.system)}  tools ${fmt(breakdown.toolSchemas)}`, BOX_WIDTH),
    boxLine(
      `user ${fmt(breakdown.user)}  asst ${fmt(breakdown.assistant)}  think ${fmt(breakdown.thinking)}`,
      BOX_WIDTH,
    ),
    boxLine(`tool results ${fmt(breakdown.toolResults)}`, BOX_WIDTH),
  ];
}

function formatAlerts(report: ContextReport): string[] {
  return report.alerts.map((alert) => {
    const paint = alert.level === "critical" ? theme.critical : theme.warn;
    return boxLine(paint(alert.message), BOX_WIDTH);
  });
}

function formatMetricsPre(event: AgentEvent, report: ContextReport): string {
  const kind = report.exactTokens !== undefined ? "exact" : "est";
  const tokens = report.exactTokens ?? report.estimatedTokens;
  const title = `CONTEXT · turn ${padTurn(event.turn)} · pre`;
  const lines = [
    boxTop(title),
    boxLine(
      `${theme.key("Tokens")}  ${theme.value(`${fmt(tokens)} / ${fmt(report.limit)}`)}  ${kind}`,
      BOX_WIDTH,
    ),
    boxLine(
      `${theme.key("Usage")}   ${theme.value(`${report.percentUsed.toFixed(1)}%`)}  ${tokenBar(report.percentUsed)}`,
      BOX_WIDTH,
    ),
    boxLine(`${theme.key("Headroom")} ${theme.value(fmt(report.headroom))}`, BOX_WIDTH),
  ];

  if (contextVerbose() >= 2) {
    lines.push(...formatBreakdown(report));
    if (report.structure.messageCount > 0) {
      lines.push(
        boxLine(
          `msgs ${report.structure.messageCount}  tool calls ${report.structure.toolCallCount}`,
          BOX_WIDTH,
        ),
      );
    }
  }

  lines.push(...formatAlerts(report));
  lines.push(boxBottom());
  return lines.join("\n");
}

function formatMetricsPost(event: AgentEvent, report: ContextReport): string {
  const usage = report.usage;
  if (!usage?.inputTokens) {
    return "";
  }

  const title = `CONTEXT · turn ${padTurn(event.turn)} · post`;
  const lines = [
    boxTop(title),
    boxLine(
      `${theme.key("Usage")}  ${theme.value(`in=${fmt(usage.inputTokens)}  out=${fmt(usage.outputTokens ?? 0)}`)}`,
      BOX_WIDTH,
    ),
  ];

  if (report.trend) {
    const delta = report.trend.deltaTokens;
    const deltaStr = delta >= 0 ? `+${fmt(delta)}` : fmt(delta);
    lines.push(
      boxLine(
        `${theme.key("Trend")}  ${theme.value(`Δ ${deltaStr}  cumulative ${fmt(report.trend.cumulativeTokens)}`)}`,
        BOX_WIDTH,
      ),
    );
  }

  if (contextVerbose() >= 2 && report.breakdown) {
    lines.push(...formatBreakdown(report));
  }

  lines.push(...formatAlerts(report));
  lines.push(boxBottom());
  return lines.join("\n");
}

export function formatContextEvent(event: AgentEvent): string | null {
  if (event.kind === "context_compact") {
    const before = Number(event.payload.beforeTokens ?? 0);
    const after = Number(event.payload.afterTokens ?? 0);
    const mode = String(event.payload.mode ?? "prune");
    return theme.border(
      `compact ${mode} ${fmt(before)}→${fmt(after)} (saved ${fmt(before - after)})`,
    );
  }

  const report = event.payload.report as ContextReport | undefined;
  if (!report) {
    return null;
  }

  if (event.kind === "metrics_pre") {
    return formatMetricsPre(event, report);
  }
  if (event.kind === "metrics_post") {
    const block = formatMetricsPost(event, report);
    return block || null;
  }
  return null;
}
