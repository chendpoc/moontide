import { randomBytes } from "node:crypto";

import { getActiveWorkMemId, isDeepModeEnabled } from "../../../agent/deep-mode.js";
import { toMessage } from "../../../errors/normalize.js";

import { appendWorkMemEvent, readWorkMemEvents } from "./store.js";
import { isValidDraftKind, packWorkMemEvents } from "./summarize.js";
import type {
  WorkMemHandlerInput,
  WorkMemHandlerResult,
  WorkMemPackTier,
} from "./types.js";

function newEntryId(): string {
  return randomBytes(4).toString("hex");
}

function resolvePackTier(action: string, tier?: string): WorkMemPackTier {
  if (action === "refine") {
    return "compact";
  }
  if (tier === "emergency") {
    return "emergency";
  }
  return "normal";
}

export function runWorkMem(
  input: WorkMemHandlerInput,
  ctx: { workdir: string; sessionId?: string },
): string {
  if (!isDeepModeEnabled()) {
    return JSON.stringify({
      status: "error",
      error: "Deep Task Mode is not enabled (use deep: prefix on your prompt)",
    } satisfies WorkMemHandlerResult);
  }

  const sessionId = ctx.sessionId;
  if (!sessionId) {
    return JSON.stringify({
      status: "error",
      error: "sessionId is required",
    } satisfies WorkMemHandlerResult);
  }

  const workMemId = getActiveWorkMemId(sessionId);
  if (!workMemId) {
    return JSON.stringify({
      status: "error",
      error: "no active deep task",
    } satisfies WorkMemHandlerResult);
  }

  const action = String(input.action ?? "").trim();
  const ts = new Date().toISOString();

  try {
    if (action === "draft") {
      const kind = String(input.kind ?? "").trim();
      const content = String(input.content ?? "").trim();
      if (!isValidDraftKind(kind)) {
        return JSON.stringify({
          status: "error",
          error: "draft kind must be outline, hypothesis, decision, or action",
        } satisfies WorkMemHandlerResult);
      }
      if (!content) {
        return JSON.stringify({
          status: "error",
          error: "content is required",
        } satisfies WorkMemHandlerResult);
      }
      appendWorkMemEvent(ctx.workdir, sessionId, workMemId, {
        kind: "workmem_draft",
        entryId: newEntryId(),
        ts,
        draftKind: kind,
        content,
      });
      return JSON.stringify({
        status: "ok",
        workMemId,
        active: true,
      } satisfies WorkMemHandlerResult);
    }

    if (action === "note") {
      const content = String(input.content ?? "").trim();
      if (!content) {
        return JSON.stringify({
          status: "error",
          error: "content is required",
        } satisfies WorkMemHandlerResult);
      }
      const ref = input.ref !== undefined ? String(input.ref).trim() : undefined;
      appendWorkMemEvent(ctx.workdir, sessionId, workMemId, {
        kind: "workmem_note",
        entryId: newEntryId(),
        ts,
        content,
        ...(ref ? { ref } : {}),
      });
      return JSON.stringify({
        status: "ok",
        workMemId,
        active: true,
      } satisfies WorkMemHandlerResult);
    }

    if (action === "summarize" || action === "refine") {
      const packTier = resolvePackTier(action, input.tier !== undefined ? String(input.tier) : undefined);
      const events = readWorkMemEvents(ctx.workdir, sessionId, workMemId);
      const maxChars =
        input.max_chars !== undefined && Number.isFinite(Number(input.max_chars))
          ? Number(input.max_chars)
          : undefined;
      const packed = packWorkMemEvents(events, packTier, maxChars);

      if (action === "refine") {
        appendWorkMemEvent(ctx.workdir, sessionId, workMemId, {
          kind: "workmem_refine",
          ts,
          tier: "compact",
          charCount: packed.charCount,
          text: packed.text,
        });
      } else {
        appendWorkMemEvent(ctx.workdir, sessionId, workMemId, {
          kind: "workmem_summary",
          ts,
          tier: packTier === "emergency" ? "emergency" : "normal",
          charCount: packed.charCount,
          text: packed.text,
        });
      }

      return JSON.stringify({
        status: "ok",
        workMemId,
        active: true,
        packTier: packed.packTier,
        text: packed.text,
        truncated: packed.truncated,
      } satisfies WorkMemHandlerResult);
    }

    return JSON.stringify({
      status: "error",
      error: "action must be draft, note, summarize, or refine",
    } satisfies WorkMemHandlerResult);
  } catch (err) {
    return JSON.stringify({
      status: "error",
      error: toMessage(err),
    } satisfies WorkMemHandlerResult);
  }
}
