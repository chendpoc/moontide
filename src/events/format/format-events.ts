import chalk from "chalk";

import type { AgentEvent } from "../types.js";
import { padTurn, truncate } from "./shared.js";

const theme = {
  marker: chalk.bgMagenta.white.bold,
  border: chalk.magenta.dim,
  kind: chalk.magenta.bold,
  channel: chalk.magenta,
  text: chalk.white,
  dim: chalk.gray,
};

function formatConversationEvent(event: AgentEvent): string | null {
  if (event.kind === "final") {
    return null;
  }

  const lines: string[] = [];
  const header =
    event.kind === "user_prompt"
      ? `${theme.marker(" EVENT ")} ${theme.kind("user_prompt")}`
      : `${theme.marker(" EVENT ")} ${theme.kind(event.kind)}`;

  lines.push(header);

  if (event.kind === "user_prompt") {
    const text = String(event.payload.text ?? event.preview ?? "");
    lines.push(theme.border("  │ ") + theme.text(truncate(text, 72)));
    return lines.join("\n");
  }

  return null;
}

function formatAuditEvent(event: AgentEvent): string | null {
  if (event.kind !== "tool_use") {
    return null;
  }

  const toolName = String(event.payload.toolName ?? "tool");
  const toolInput = event.payload.toolInput;
  const inputPreview =
    toolInput && typeof toolInput === "object"
      ? truncate(JSON.stringify(toolInput), 60)
      : "";

  const lines = [
    `${theme.marker(" EVENT ")} ${theme.channel("audit")} · ${theme.kind("tool_use")} · turn ${padTurn(event.turn)}`,
    theme.border("  │ ") + theme.text(toolName) + (inputPreview ? theme.dim(`  ${inputPreview}`) : ""),
  ];
  return lines.join("\n");
}

export function formatEventsChannelEvent(event: AgentEvent): string | null {
  if (event.channel === "conversation") {
    return formatConversationEvent(event);
  }
  if (event.channel === "audit") {
    return formatAuditEvent(event);
  }
  return null;
}
