import { getWorkdir } from "../config.js";
import {
  ALL_STATUS_LINE_SEGMENT_IDS,
  DEFAULT_STATUS_LINE_SEGMENTS,
  type StatusLineConfig,
  type StatusLineSegmentId,
} from "../cli/statusline/types.js";
import { ensureDir } from "../utils/fs.js";
import { dataPath } from "../utils/path.js";
import { readWorkspaceConfig, writeWorkspaceConfig } from "./workspace-config.js";

const DEFAULT_COMMAND_TIMEOUT_MS = 1000;

function isSegmentId(value: string): value is StatusLineSegmentId {
  return (ALL_STATUS_LINE_SEGMENT_IDS as string[]).includes(value);
}

function parseSegments(raw: unknown): StatusLineSegmentId[] {
  if (!Array.isArray(raw)) {
    return [...DEFAULT_STATUS_LINE_SEGMENTS];
  }
  const segments = raw.filter((item): item is StatusLineSegmentId => typeof item === "string" && isSegmentId(item));
  return segments.length > 0 ? segments : [...DEFAULT_STATUS_LINE_SEGMENTS];
}

export function loadStatusLineConfig(workdir = getWorkdir()): StatusLineConfig {
  const root = readWorkspaceConfig(workdir);
  const ui = root.ui as Record<string, unknown> | undefined;
  const section = ui?.status_line as Record<string, unknown> | undefined;

  const command =
    typeof section?.command === "string" && section.command.trim().length > 0
      ? section.command.trim()
      : undefined;

  const timeoutRaw = section?.command_timeout_ms;
  const commandTimeoutMs =
    typeof timeoutRaw === "number" && timeoutRaw > 0
      ? timeoutRaw
      : DEFAULT_COMMAND_TIMEOUT_MS;

  return {
    segments: parseSegments(section?.segments),
    command,
    commandTimeoutMs,
  };
}

export function saveStatusLineSegments(
  segments: StatusLineSegmentId[],
  workdir = getWorkdir(),
): void {
  const root = readWorkspaceConfig(workdir);
  const ui = (root.ui as Record<string, unknown> | undefined) ?? {};
  const section = (ui.status_line as Record<string, unknown> | undefined) ?? {};

  ui.status_line = {
    ...section,
    segments,
  };
  root.ui = ui;

  ensureDir(dataPath(workdir));
  writeWorkspaceConfig(root, workdir);
}

export function resetStatusLineConfig(workdir = getWorkdir()): void {
  saveStatusLineSegments([...DEFAULT_STATUS_LINE_SEGMENTS], workdir);
}

export function describeStatusLineSegments(): string {
  return ALL_STATUS_LINE_SEGMENT_IDS.join(", ");
}
