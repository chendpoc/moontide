import chalk from "chalk";

import type { AgentEvent } from "../types.js";
import { padTurn } from "./shared.js";
import { truncateOneLine } from "../../utils/text.js";

const theme = {
  rail: chalk.gray,
  turn: chalk.yellow.bold,
  think: chalk.blue,
  tool: chalk.hex("#FFA500"),
  result: chalk.green,
  out: chalk.white.bold,
  dim: chalk.gray,
};

type TraceKindMeta = {
  icon: string;
  label: string;
  paint: (text: string) => string;
  formatBody: (event: AgentEvent) => string;
  extra?: (event: AgentEvent) => string | undefined;
};

const TRACE_KIND_FORMATTERS: Partial<Record<string, TraceKindMeta>> = {
  thinking: {
    icon: "💭",
    label: "think",
    paint: theme.think,
    formatBody: (event) =>
      `"${truncateOneLine(String(event.payload.body ?? event.preview ?? ""))}"`,
  },
  tool_use: {
    icon: "🔧",
    label: "tool",
    paint: theme.tool,
    formatBody: (event) => truncateOneLine(String(event.payload.body ?? event.preview ?? "")),
    extra: (event) => `${String(event.payload.toolName ?? "tool")}  `,
  },
  tool_result: {
    icon: "✓",
    label: "result",
    paint: theme.result,
    formatBody: (event) => truncateOneLine(String(event.payload.body ?? event.preview ?? "")),
    extra: (event) => `${String(event.payload.toolName ?? "tool")}  `,
  },
  assistant_text: {
    icon: "→",
    label: "out",
    paint: theme.out,
    formatBody: (event) => truncateOneLine(String(event.payload.body ?? event.preview ?? "")),
  },
};

function formatTraceStep(
  event: AgentEvent,
  meta: TraceKindMeta,
  body: string,
  extra?: string,
): string {
  const turn = padTurn(event.turn);
  const label = meta.label.padEnd(6);
  const prefix = `${theme.rail("  ▸")} ${theme.turn(`turn ${turn}`)}  ${meta.icon}  ${meta.paint(label)}`;
  if (extra) {
    return `${prefix}${meta.paint(extra)}  ${theme.dim(body)}`;
  }
  return `${prefix}${theme.dim(body)}`;
}

export function formatTraceEvent(event: AgentEvent): string | null {
  const meta = TRACE_KIND_FORMATTERS[event.kind];
  if (!meta) {
    return null;
  }
  return formatTraceStep(event, meta, meta.formatBody(event), meta.extra?.(event));
}
