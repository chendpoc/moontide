import { stripAnsi } from "../../utils/text.js";

export function fmt(value: number): string {
  return value.toLocaleString("en-US");
}

export function padTurn(turn: number): string {
  return String(turn).padStart(2, "0");
}

export function boxLine(content: string, width: number): string {
  const visible = stripAnsi(content);
  const inner =
    visible.length <= width ? content : truncateVisible(content, width);
  const padWidth = width - stripAnsi(inner).length;
  return `│ ${inner}${" ".repeat(Math.max(0, padWidth))} │`;
}

function truncateVisible(content: string, width: number): string {
  let visibleLen = 0;
  let result = "";
  // eslint-disable-next-line no-control-regex -- intentional ANSI escape handling
  const ansiPattern = /\u001b\[[0-9;]*m/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = ansiPattern.exec(content)) !== null) {
    const textBefore = content.slice(lastIndex, match.index);
    for (const char of textBefore) {
      if (visibleLen >= width) {
        return result;
      }
      result += char;
      visibleLen += 1;
    }
    result += match[0];
    lastIndex = match.index + match[0].length;
  }

  const rest = content.slice(lastIndex);
  for (const char of rest) {
    if (visibleLen >= width) {
      break;
    }
    result += char;
    visibleLen += 1;
  }
  return result;
}

const TURN_BANNER_WIDTH = 36;

export function formatTurnBanner(turn: number): string {
  const label = ` turn ${padTurn(turn)} `;
  const dashes = Math.max(2, TURN_BANNER_WIDTH - label.length);
  return `──${label}${"─".repeat(dashes)}`;
}

export function formatChannelSeparator(from: string, to: string): string {
  return `· ${from} → ${to} `;
}
