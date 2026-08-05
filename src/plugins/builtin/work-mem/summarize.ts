import { estimateTextTokens } from "../../../context-inspect/metrics.js";

import { maxCharsForPackTier, workMemNoteTailForTier } from "./config.js";
import type {
  WorkMemDraftEvent,
  WorkMemEvent,
  WorkMemNoteEvent,
  WorkMemPackTier,
  WorkMemStartedEvent,
} from "./types.js";

const DRAFT_KINDS = ["outline", "hypothesis", "decision", "action"] as const;

export interface PackResult {
  text: string;
  charCount: number;
  truncated: boolean;
  packTier: WorkMemPackTier;
}

function latestDrafts(events: WorkMemEvent[]): Map<string, WorkMemDraftEvent> {
  const map = new Map<string, WorkMemDraftEvent>();
  for (const event of events) {
    if (event.kind !== "workmem_draft") {
      continue;
    }
    map.set(event.draftKind, event);
  }
  return map;
}

function latestNotes(events: WorkMemEvent[], limit: number): WorkMemNoteEvent[] {
  const notes = events.filter((event): event is WorkMemNoteEvent => event.kind === "workmem_note");
  return notes.slice(-limit);
}

function startedGoal(events: WorkMemEvent[]): string | undefined {
  const started = events.find((event): event is WorkMemStartedEvent => event.kind === "workmem_started");
  return started?.goal;
}

function section(title: string, body: string | undefined): string {
  if (!body?.trim()) {
    return "";
  }
  return `## ${title}\n${body.trim()}\n`;
}

function buildNormalPack(events: WorkMemEvent[], noteTail: number): string {
  const drafts = latestDrafts(events);
  const parts = [
    section("Outline", drafts.get("outline")?.content),
    section("Hypotheses", drafts.get("hypothesis")?.content),
    section("Decisions", drafts.get("decision")?.content),
    section("Actions", drafts.get("action")?.content),
  ].filter(Boolean);

  const notes = latestNotes(events, noteTail);
  if (notes.length > 0) {
    const noteLines = notes.map((note) => {
      const ref = note.ref ? ` (ref: ${note.ref})` : "";
      return `- ${note.content}${ref}`;
    });
    parts.push(`## Recent notes\n${noteLines.join("\n")}\n`);
  }

  return parts.join("\n").trim();
}

function buildCompactPack(events: WorkMemEvent[], noteTail: number): string {
  const drafts = latestDrafts(events);
  const parts = [
    section("Outline", drafts.get("outline")?.content),
    section("Decisions", drafts.get("decision")?.content),
  ].filter(Boolean);

  const hypothesis = drafts.get("hypothesis")?.content;
  if (hypothesis?.trim()) {
    parts.push(`## Hypotheses\n- ${hypothesis.trim().replace(/\n+/g, " ")}\n`);
  }

  const notes = latestNotes(events, noteTail);
  if (notes.length > 0) {
    const noteLines = notes.map((note) => `- ${note.content}`);
    parts.push(`## Recent notes\n${noteLines.join("\n")}\n`);
  }

  return parts.join("\n").trim();
}

function buildEmergencyPack(events: WorkMemEvent[], noteTail: number): string {
  const drafts = latestDrafts(events);
  const parts = [
    section("Goal", startedGoal(events)),
    section("Decisions", drafts.get("decision")?.content),
    section("Open questions", drafts.get("outline")?.content),
  ].filter(Boolean);

  const notes = latestNotes(events, noteTail);
  if (notes.length > 0) {
    parts.push(`## Recent notes\n- ${notes[0]!.content}\n`);
  }

  return parts.join("\n").trim();
}

function truncateToChars(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  return { text: `${text.slice(0, maxChars)}\n…`, truncated: true };
}

export function packWorkMemEvents(
  events: WorkMemEvent[],
  tier: WorkMemPackTier,
  maxCharsOverride?: number,
): PackResult {
  const noteTail = workMemNoteTailForTier(tier);
  const text =
    tier === "emergency"
      ? buildEmergencyPack(events, noteTail)
      : tier === "compact"
        ? buildCompactPack(events, noteTail)
        : buildNormalPack(events, noteTail);

  const maxChars = maxCharsForPackTier(tier, maxCharsOverride);
  const capped = truncateToChars(text, maxChars);
  return {
    text: capped.text,
    charCount: capped.text.length,
    truncated: capped.truncated,
    packTier: tier,
  };
}

export function estimatePackTokens(text: string): number {
  return estimateTextTokens(text);
}

export function isValidDraftKind(kind: string): kind is (typeof DRAFT_KINDS)[number] {
  return (DRAFT_KINDS as readonly string[]).includes(kind);
}

export function latestPackText(events: WorkMemEvent[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event?.kind === "workmem_summary" || event?.kind === "workmem_refine") {
      return event.text;
    }
  }
  return undefined;
}
