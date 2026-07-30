import { enrichEvent } from "./enrich.js";
import type { AgentEvent, EnrichedAgentEvent } from "./types.js";

export const MAX_PERSISTED_EVENT_BYTES = 64 * 1024;

export interface PersistedAgentEvent extends EnrichedAgentEvent {
  truncated?: boolean;
  originalBytes?: number;
}

export interface SerializedEvent {
  event: PersistedAgentEvent;
  line: string;
  bytes: number;
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function truncateUtf8(text: string, maxBytes: number): string {
  if (byteLength(text) <= maxBytes) {
    return text;
  }

  const bytes = Buffer.from(text, "utf8");
  let end = Math.min(bytes.length, maxBytes);
  while (end > 0 && end < bytes.length && (bytes[end]! & 0xc0) === 0x80) {
    end -= 1;
  }
  return bytes.subarray(0, end).toString("utf8");
}

function projectContextPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const rawReport = payload.report;
  if (!rawReport || typeof rawReport !== "object" || Array.isArray(rawReport)) {
    return structuredClone(payload);
  }

  const report = structuredClone(rawReport) as Record<string, unknown>;
  delete report.messageLines;
  delete report.messages;
  delete report.system;
  delete report.tools;
  return { report };
}

function projectPayload(event: AgentEvent): Record<string, unknown> {
  if (event.channel === "context") {
    return projectContextPayload(event.payload);
  }

  if (event.channel === "audit") {
    return {
      toolName: event.payload.toolName,
    };
  }

  if (event.channel === "trace" && event.kind === "tool_use") {
    const payload = structuredClone(event.payload);
    delete payload.body;
    return payload;
  }

  return structuredClone(event.payload);
}

function projectPreview(event: AgentEvent): string | undefined {
  const preview =
    event.channel === "trace" && event.kind === "tool_use"
      ? String(event.payload.toolName ?? event.preview ?? "tool")
      : event.preview;
  if (preview === undefined) {
    return undefined;
  }
  return truncateUtf8(preview, 1024);
}

function compactPayload(
  event: PersistedAgentEvent,
  maxContentBytes: number,
): Record<string, unknown> {
  const payload = event.payload;
  const compact: Record<string, unknown> = {};

  for (const key of [
    "toolName",
    "toolUseId",
    "charCount",
    "mode",
    "beforeTokens",
    "afterTokens",
    "savedTokens",
    "truncatedToolResults",
    "keepFromIndex",
  ]) {
    if (payload[key] !== undefined) {
      compact[key] = payload[key];
    }
  }

  for (const key of ["body", "text"]) {
    const value = payload[key];
    if (typeof value === "string") {
      compact[key] = truncateUtf8(value, maxContentBytes);
      return compact;
    }
  }

  if (payload.input !== undefined) {
    const input = JSON.stringify(payload.input);
    compact.inputPreview = truncateUtf8(input, maxContentBytes);
    return compact;
  }

  if (payload.report !== undefined) {
    compact.report = payload.report;
  }

  return compact;
}

function serialize(event: PersistedAgentEvent): SerializedEvent {
  const line = `${JSON.stringify(event)}\n`;
  return {
    event,
    line,
    bytes: byteLength(line),
  };
}

export function serializePersistedEvent(
  event: AgentEvent,
  maxBytes = MAX_PERSISTED_EVENT_BYTES,
): SerializedEvent {
  const projected = enrichEvent({
    ...event,
    payload: projectPayload(event),
    preview: projectPreview(event),
  }) as PersistedAgentEvent;
  const initial = serialize(projected);
  if (initial.bytes <= maxBytes) {
    return initial;
  }

  const originalBytes = initial.bytes;
  let low = 0;
  let high = Math.max(0, maxBytes);
  let best = serialize({
    ...projected,
    payload: compactPayload(projected, 0),
    truncated: true,
    originalBytes,
  });

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = serialize({
      ...projected,
      payload: compactPayload(projected, mid),
      truncated: true,
      originalBytes,
    });
    if (candidate.bytes <= maxBytes) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (best.bytes <= maxBytes) {
    return best;
  }

  return serialize({
    ...projected,
    payload: {},
    truncated: true,
    originalBytes,
  });
}
