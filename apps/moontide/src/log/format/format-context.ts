import chalk from "chalk";

import {
  contextCopy,
  fmtNum,
  formatAlert,
  formatPercent,
} from "../../i18n/context/index.js";
import { isVerboseEnabled } from "../modes.js";
import type { ContextReport } from "../../context-inspect/types.js";
import type { AgentEvent } from "@moontide/log";
import { formatCompactTokens } from "../../cli/statusline/format-tokens.js";
import { formatDeltaColored } from "./format-delta.js";
import { formatPluginErrorEvent } from "./format-error.js";
import { padTurn } from "./shared.js";

const theme = {
  border: chalk.cyan.dim,
  label: chalk.cyan.dim,
  warn: chalk.yellow,
  critical: chalk.red.bold,
};

function formatContextVerboseLine(event: AgentEvent, report: ContextReport): string {
  const tokens = report.exactTokens ?? report.estimatedTokens;
  const used = formatCompactTokens(tokens);
  const limit = formatCompactTokens(report.limit);
  const pct = formatPercent(report.percentUsed);
  const parts = [
    theme.label(`context · turn ${padTurn(event.turn)} · ${used}/${limit} (${pct})`),
  ];

  if (report.trend.hasBaseline && report.trend.deltaTokens !== 0) {
    parts.push(formatDeltaColored(report.trend.deltaTokens));
  }

  for (const alert of report.alerts) {
    const paint = alert.level === "critical" ? theme.critical : theme.warn;
    parts.push(paint(formatAlert(alert)));
  }

  return parts.join(chalk.dim(" · "));
}

type ContextKindFormatter = (event: AgentEvent, report: ContextReport) => string | null;

function formatMetricsKind(
  event: AgentEvent,
  report: ContextReport,
  _phase?: "pre" | "post",
): string | null {
  if (isVerboseEnabled()) {
    return formatContextVerboseLine(event, report);
  }
  return null;
}

const CONTEXT_KIND_FORMATTERS: Record<string, ContextKindFormatter> = {
  context_metrics: (event, report) => formatMetricsKind(event, report),
  metrics_pre: (event, report) => formatMetricsKind(event, report, "pre"),
  metrics_post: (event, report) => formatMetricsKind(event, report, "post"),
};

export function formatContextEvent(event: AgentEvent): string | null {
  if (event.kind === "plugin_error") {
    return formatPluginErrorEvent(event);
  }

  if (event.kind === "context_compact") {
    const copy = contextCopy();
    const before = fmtNum(Number(event.payload.beforeTokens ?? 0));
    const after = fmtNum(Number(event.payload.afterTokens ?? 0));
    const saved = fmtNum(Number(event.payload.beforeTokens ?? 0) - Number(event.payload.afterTokens ?? 0));
    const mode = String(event.payload.mode ?? "prune");
    return theme.border(copy.compact(mode, before, after, saved));
  }

  const report = event.payload.report as ContextReport | undefined;
  if (!report) {
    return null;
  }

  const formatter = CONTEXT_KIND_FORMATTERS[event.kind];
  return formatter?.(event, report) ?? null;
}
