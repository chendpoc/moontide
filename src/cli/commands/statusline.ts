import {
  describeStatusLineSegments,
  loadStatusLineConfig,
  resetStatusLineConfig,
  saveStatusLineSegments,
} from "../../config/status-line.js";
import { collectStatusSnapshot } from "../statusline/collect.js";
import {
  formatSegmentCatalog,
  formatStatusLinePreview,
} from "../statusline/format.js";
import { invalidateStatusLineCommandCache, renderStatusStackAsync } from "../statusline/render-stack.js";
import { ALL_STATUS_LINE_SEGMENT_IDS, type StatusLineSegmentId } from "../statusline/types.js";
import { reply } from "./io.js";
import type { ReplCommandResult } from "./types.js";

function isSegmentId(value: string): value is StatusLineSegmentId {
  return (ALL_STATUS_LINE_SEGMENT_IDS as string[]).includes(value);
}

function parseSegmentArgs(args: string): StatusLineSegmentId[] | null {
  const ids = args
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (ids.length === 0) {
    return null;
  }

  const invalid = ids.find((id) => !isSegmentId(id));
  if (invalid) {
    return null;
  }

  return ids as StatusLineSegmentId[];
}

export async function handleStatuslineCommand(arg: string | undefined): Promise<ReplCommandResult> {
  const trimmed = arg?.trim() ?? "";

  if (!trimmed || trimmed === "status") {
    const config = loadStatusLineConfig();
    const snapshot = collectStatusSnapshot();
    reply(formatStatusLinePreview(snapshot));
    reply(`segments: ${config.segments.join(", ")}`);
    if (config.command) {
      reply(`command: ${config.command}`);
    }
    reply("available:");
    reply(formatSegmentCatalog(config.segments));
    reply(`usage: /statusline set ${describeStatusLineSegments()}`);
    return "handled";
  }

  if (trimmed === "reset") {
    resetStatusLineConfig();
    invalidateStatusLineCommandCache();
    await renderStatusStackAsync();
    reply("statusline reset to default: product, context, turn, model, workdir");
    return "handled";
  }

  if (trimmed === "preview") {
    reply(formatStatusLinePreview(collectStatusSnapshot()));
    return "handled";
  }

  if (trimmed.startsWith("set ")) {
    const segments = parseSegmentArgs(trimmed.slice(4));
    if (!segments) {
      reply(`usage: /statusline set ${describeStatusLineSegments()}`);
      return "handled";
    }
    saveStatusLineSegments(segments);
    invalidateStatusLineCommandCache();
    await renderStatusStackAsync();
    reply(`statusline segments: ${segments.join(", ")}`);
    return "handled";
  }

  reply("usage: /statusline [status|set <ids>|reset|preview]");
  return "handled";
}
