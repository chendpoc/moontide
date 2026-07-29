import chalk from "chalk";

import type { ContextAlert, ContextReport, MessageLine, MessageLineDetail } from "./types.js";

const BAR_WIDTH = 24;
const DETAIL_MAX_LINES = 12;
const DETAIL_MAX_CHARS = 2_000;

function fmt(value: number): string {
  return value.toLocaleString("en-US");
}

function pct(value: number): string {
  return `${value.toFixed(1)}%`;
}

function tokenCount(report: ContextReport): number {
  return report.exactTokens ?? report.estimatedTokens;
}

function tokenKind(report: ContextReport): string {
  return report.exactTokens !== undefined ? "exact" : "est";
}

function usageTone(percent: number): (text: string) => string {
  if (percent >= 90) {
    return chalk.red.bold;
  }
  if (percent >= 70) {
    return chalk.yellow;
  }
  return chalk.green;
}

function renderBar(percent: number): string {
  const clamped = Math.min(100, Math.max(0, percent));
  const filled = Math.round((clamped / 100) * BAR_WIDTH);
  const empty = BAR_WIDTH - filled;
  return usageTone(clamped)("█".repeat(filled)) + chalk.dim("░".repeat(empty));
}

function formatDelta(delta: number): string {
  const sign = delta >= 0 ? "+" : "";
  const text = `${sign}${fmt(delta)}`;
  if (delta > 5_000) {
    return chalk.red(text);
  }
  if (delta > 1_000) {
    return chalk.yellow(text);
  }
  if (delta === 0) {
    return chalk.dim(text);
  }
  return chalk.cyan(text);
}

function roleTone(role: string): (text: string) => string {
  switch (role) {
    case "user":
      return chalk.cyan;
    case "assistant":
      return chalk.green;
    default:
      return chalk.white;
  }
}

function primaryLabel(label: string): string {
  return label.split(" + ")[0]?.split(":")[0] ?? label;
}

function labelTone(label: string): (text: string) => string {
  switch (primaryLabel(label)) {
    case "thinking":
      return chalk.magenta;
    case "tool_use":
      return chalk.yellow;
    case "tool_result":
      return chalk.blue;
    case "text":
      return chalk.green;
    default:
      return chalk.dim;
  }
}

function renderAlert(alert: ContextAlert): string {
  const icon = alert.level === "critical" ? chalk.red.bold("!!") : chalk.yellow("!");
  const tone = alert.level === "critical" ? chalk.red : chalk.yellow;
  return `  ${icon} ${tone(alert.message)}`;
}

function renderHeader(phase: "pre" | "post", turn: number): string {
  const phaseLabel =
    phase === "pre" ? chalk.blueBright.bold("pre-LLM") : chalk.magentaBright.bold("post-LLM");
  return chalk.dim("── ") + chalk.bold("context") + chalk.dim(" · ") + phaseLabel + chalk.dim(` · turn ${turn} `) + chalk.dim("─".repeat(28));
}

function renderUsageLine(report: ContextReport): string {
  const tokens = tokenCount(report);
  const kind = tokenKind(report);
  const tone = usageTone(report.percentUsed);
  const kindLabel = kind === "exact" ? chalk.green("exact") : chalk.dim("est");

  return [
    "  ",
    chalk.dim("tokens "),
    kindLabel,
    " ",
    tone(fmt(tokens)),
    chalk.dim(" / "),
    chalk.white(fmt(report.limit)),
    chalk.dim("  "),
    tone(`(${pct(report.percentUsed)})`),
    "  ",
    renderBar(report.percentUsed),
  ].join("");
}

function renderMetaLine(report: ContextReport): string {
  return [
    "  ",
    chalk.dim("headroom "),
    chalk.white.bold(fmt(report.headroom)),
    chalk.dim("  ·  msgs "),
    chalk.white(String(report.structure.messageCount)),
    chalk.dim("  ·  tool_calls "),
    chalk.white(String(report.structure.toolCallCount)),
    chalk.dim("  ·  Δ "),
    formatDelta(report.trend.deltaTokens),
  ].join("");
}

function expandBodyLines(
  body: string,
  maxLines: number,
  maxChars: number,
): { lines: string[]; truncated: boolean; omittedLines: number } {
  const normalized = body.replace(/\r\n/g, "\n");
  const allLines = normalized.split("\n");
  const lines: string[] = [];
  let charBudget = maxChars;

  for (const line of allLines) {
    if (lines.length >= maxLines || charBudget <= 0) {
      break;
    }

    if (line.length <= charBudget) {
      lines.push(line);
      charBudget -= line.length + 1;
      continue;
    }

    lines.push(`${line.slice(0, charBudget)}…`);
    charBudget = 0;
  }

  const truncated = lines.length < allLines.length || normalized.length > maxChars;
  return {
    lines,
    truncated,
    omittedLines: Math.max(0, allLines.length - lines.length),
  };
}

function renderToolResultDetail(detail: MessageLineDetail, isLast: boolean): string[] {
  const lines: string[] = [];
  const branch = isLast ? "└─" : "├─";
  const id = detail.toolUseId ? chalk.cyan(detail.toolUseId) : chalk.dim("unknown");
  lines.push(
    `        ${chalk.dim(branch)} ${chalk.blue.bold("tool_result")} ${id}  ${chalk.white.bold(fmt(detail.tokens))} tok  ${chalk.dim(`${fmt(detail.charCount)} chars`)}`,
  );

  if (!detail.body) {
    return lines;
  }

  const expanded = expandBodyLines(detail.body, DETAIL_MAX_LINES, DETAIL_MAX_CHARS);
  for (const [idx, bodyLine] of expanded.lines.entries()) {
    const isLastBodyLine = idx === expanded.lines.length - 1 && !expanded.truncated;
    const cont = isLastBodyLine ? "└" : "│";
    lines.push(`        ${chalk.dim(cont)} ${bodyLine}`);
  }

  if (expanded.truncated) {
    lines.push(
      `        ${chalk.dim("└")} ${chalk.dim(`… ${expanded.omittedLines} more line(s), ${fmt(detail.charCount)} chars total`)}`,
    );
  }

  return lines;
}

function renderToolResultDetails(line: MessageLine): string[] {
  const toolResults = line.details?.filter((detail) => detail.kind === "tool_result") ?? [];
  if (toolResults.length === 0) {
    return [];
  }

  const lines: string[] = [];
  for (const [idx, detail] of toolResults.entries()) {
    lines.push(...renderToolResultDetail(detail, idx === toolResults.length - 1));
  }
  return lines;
}

function hasToolResultDetails(line: MessageLine): boolean {
  return (line.details?.some((detail) => detail.kind === "tool_result") ?? false);
}

function renderMessageLine(line: MessageLine, isLast: boolean, hasChildren: boolean): string {
  const branch = hasChildren ? "├─" : isLast ? "└─" : "├─";
  const role = roleTone(line.role)(line.role.padEnd(9));
  const label = labelTone(line.label)(primaryLabel(line.label).padEnd(11));
  const tokens = chalk.white.bold(fmt(line.tokens).padStart(6));
  const preview = chalk.dim(`"${line.preview}"`);

  return `     ${chalk.dim(branch)} ${chalk.dim(`[${line.index}]`)} ${role} ${tokens} tok  ${label} ${preview}`;
}

export function renderPreLlmVerbose(report: ContextReport, level: 1 | 2, expandDetail = false): string[] {
  const lines = [renderHeader("pre", report.turn), renderUsageLine(report), renderMetaLine(report)];

  for (const alert of report.alerts) {
    lines.push(renderAlert(alert));
  }

  if (level >= 2) {
    lines.push(
      "",
      chalk.dim("  breakdown"),
      `  ${chalk.dim("├─")} system          ${chalk.white.bold(fmt(report.breakdown.system))} ${chalk.dim("tok")}`,
      `  ${chalk.dim("├─")} tool_schemas    ${chalk.white.bold(fmt(report.breakdown.toolSchemas))} ${chalk.dim("tok")}`,
      `  ${chalk.dim("└─")} messages${chalk.white(`[${report.structure.messageCount}]`)}`,
    );

    if (expandDetail) {
      lines.push(chalk.dim("     tool_result detail ON"));
    }

    for (const [idx, line] of report.messageLines.entries()) {
      const isLastMessage = idx === report.messageLines.length - 1;
      const showDetails = expandDetail && hasToolResultDetails(line);
      lines.push(renderMessageLine(line, isLastMessage, showDetails));
      if (showDetails) {
        lines.push(...renderToolResultDetails(line));
      }
    }
  }

  return lines;
}

export function renderPostLlmVerbose(report: ContextReport): string[] | null {
  const usage = report.usage;
  if (!usage?.inputTokens) {
    return null;
  }

  const estDelta = usage.inputTokens - report.estimatedTokens;
  const estDeltaText =
    estDelta === 0
      ? chalk.dim("±0 vs est")
      : estDelta > 0
        ? chalk.yellow(`+${fmt(estDelta)} vs est`)
        : chalk.cyan(`${fmt(estDelta)} vs est`);

  const lines = [
    renderHeader("post", report.turn),
    [
      "  ",
      chalk.dim("API usage  "),
      chalk.dim("in "),
      chalk.cyan.bold(fmt(usage.inputTokens)),
      chalk.dim("  out "),
      chalk.magenta.bold(fmt(usage.outputTokens ?? 0)),
      chalk.dim("  ·  "),
      estDeltaText,
    ].join(""),
  ];

  if (report.alerts.length > 0) {
    lines.push(...report.alerts.map(renderAlert));
  }

  return lines;
}

export { expandBodyLines };
