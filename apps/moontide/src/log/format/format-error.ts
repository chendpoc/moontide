import chalk from "chalk";

import { DATA_DIR } from "@moontide/shared/constants/storage.js";
import { isVerboseEnabled } from "../modes.js";
import type { ErrorRecord } from "@moontide/shared/errors/record.js";
import { debugLogPath } from "../../context-inspect/debug-file.js";
import { getRunId } from "@moontide/log";

const theme = {
  marker: chalk.bgRed.white.bold,
  code: chalk.red.bold,
  label: chalk.red.dim,
  message: chalk.white,
  context: chalk.yellow,
  hint: chalk.cyan.dim,
  stack: chalk.gray.dim,
};

function formatContext(context: Record<string, unknown>): string[] {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(context)) {
    const rendered =
      value === null || value === undefined
        ? String(value)
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
    parts.push(`${key}=${rendered}`);
  }
  return parts.length > 0 ? [theme.label("  context ") + theme.context(parts.join("  "))] : [];
}

function formatStack(stack: string, verbose: boolean): string[] {
  const lines = stack.split("\n");
  if (!verbose) {
    return [];
  }
  const visible = lines.slice(0, 8);
  return [
    theme.label("  stack   ") + theme.stack(visible[0] ?? ""),
    ...visible.slice(1).map((line) => theme.stack(`          ${line}`)),
  ];
}

export function formatErrorTerminal(
  record: ErrorRecord,
  opts?: { verbose?: boolean; includeHint?: boolean },
): string {
  const verbose = opts?.verbose ?? isVerboseEnabled();
  const includeHint = opts?.includeHint ?? true;

  const locationParts = [
    record.toolName ? `tool:${record.toolName}` : undefined,
    record.hook ? `hook:${record.hook}` : undefined,
    record.phase ? record.phase : undefined,
    record.turn !== undefined ? `turn ${String(record.turn).padStart(2, "0")}` : undefined,
  ].filter(Boolean);

  const header = `${theme.marker(" ERROR ")} ${theme.code(record.code)}${
    locationParts.length > 0 ? theme.label(` · ${locationParts.join(" · ")}`) : ""
  }`;

  const lines = [
    header,
    theme.label("  message ") + theme.message(record.message),
    ...formatContext(record.context ?? {}),
  ];

  if (record.cause) {
    lines.push(theme.label("  cause   ") + theme.message(record.cause));
  }

  if (record.stack) {
    lines.push(...formatStack(record.stack, verbose));
  }

  if (includeHint) {
    lines.push(
      theme.hint(
        `  hint    /debug file — full record in ${debugLogPath(undefined, getRunId())} · grep plugin_error ${DATA_DIR}/runs/${getRunId()}.active.jsonl`,
      ),
    );
  }

  return lines.join("\n");
}

export function formatPluginErrorEvent(event: {
  payload: Record<string, unknown>;
  turn: number;
  preview?: string;
}): string | null {
  const code = String(event.payload.errorCode ?? event.payload.code ?? "internal");
  const message = String(event.payload.message ?? event.preview ?? "");
  const toolName = event.payload.toolName !== undefined ? String(event.payload.toolName) : undefined;
  const hook = event.payload.hook !== undefined ? String(event.payload.hook) : undefined;

  const record: ErrorRecord = {
    code: code as ErrorRecord["code"],
    message,
    source: String(event.payload.source ?? "plugin"),
    turn: event.turn,
    toolName,
    hook,
    context:
      event.payload.context && typeof event.payload.context === "object"
        ? (event.payload.context as Record<string, unknown>)
        : undefined,
    stack: event.payload.stack !== undefined ? String(event.payload.stack) : undefined,
  };

  return formatErrorTerminal(record, { includeHint: false });
}
