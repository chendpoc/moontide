import { renderStatusLine } from "../statusline/render.js";

export function reply(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

export function toggle(
  value: string | undefined,
  on: () => void,
  off: () => void,
): boolean {
  const v = (value ?? "").toLowerCase();
  if (v === "on") {
    on();
    return true;
  }
  if (v === "off") {
    off();
    return true;
  }
  return false;
}

export function handleToggleCommand(
  name: string,
  arg: string | undefined,
  on: () => void,
  off: () => void,
): boolean {
  if (!toggle(arg, on, off)) {
    reply(`${name}: use 'on' or 'off'`);
    return true;
  }
  renderStatusLine();
  return true;
}

export function formatCompactReport(
  label: string,
  before: number,
  after: number,
  extra?: string,
): string {
  const saved = before - after;
  const tail = extra ? ` · ${extra}` : "";
  return `${label}: ${before.toLocaleString()} → ${after.toLocaleString()} tokens (saved ${saved.toLocaleString()})${tail}`;
}
