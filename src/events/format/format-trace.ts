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

const kindMeta: Record<
  string,
  { icon: string; label: string; paint: (text: string) => string }
> = {
  thinking: { icon: "💭", label: "think", paint: theme.think },
  tool_use: { icon: "🔧", label: "tool", paint: theme.tool },
  tool_result: { icon: "✓", label: "result", paint: theme.result },
  assistant_text: { icon: "→", label: "out", paint: theme.out },
};

function formatTraceStep(
  event: AgentEvent,
  meta: { icon: string; label: string; paint: (text: string) => string },
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
  const meta = kindMeta[event.kind];
  if (!meta) {
    return null;
  }

  switch (event.kind) {
    case "thinking":
      return formatTraceStep(
        event,
        meta,
        `"${truncateOneLine(String(event.payload.body ?? event.preview ?? ""))}"`,
      );
    case "tool_use": {
      const toolName = String(event.payload.toolName ?? "tool");
      const preview = event.preview ?? truncateOneLine(String(event.payload.body ?? ""));
      return formatTraceStep(event, meta, preview, `${toolName}  `);
    }
    case "tool_result": {
      const toolName = String(event.payload.toolName ?? "tool");
      const preview = truncateOneLine(String(event.payload.body ?? event.preview ?? ""));
      return formatTraceStep(event, meta, preview, `${toolName}  `);
    }
    case "assistant_text":
      return formatTraceStep(
        event,
        meta,
        truncateOneLine(String(event.payload.body ?? event.preview ?? "")),
      );
    default:
      return null;
  }
}
