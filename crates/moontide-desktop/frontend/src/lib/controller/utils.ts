import type {
  DesktopSnapshot,
  parseDesktopMessageEnvelope,
  SessionCatalogRow,
} from "$lib/protocol/index.js";
import type { FirstSendState, SessionCatalogState } from "./type.js";

export function isFirstSendInFlight(state: FirstSendState): boolean {
  return state.kind === "creating_session" || state.kind === "submitting_first_turn";
}

export function validateCatalogLoadedIdentity(
  rows: SessionCatalogRow[],
  loadedSessionId: string | undefined,
): void {
  const loaded = rows.filter((row) => row.loaded);
  if (loaded.length > 1) {
    throw new Error("Desktop catalog contains more than one loaded Session");
  }
  if (loadedSessionId === undefined && loaded.length !== 0) {
    throw new Error("Desktop catalog marks a Session loaded while the page is Blank");
  }
  if (loadedSessionId !== undefined && loaded[0]?.session_id !== loadedSessionId) {
    throw new Error("Desktop catalog loaded Session does not match the snapshot");
  }
}

export function catalogWithoutLoaded(catalog: SessionCatalogState): SessionCatalogState {
  const rows = catalog.rows.map((row) => ({ ...row, loaded: false }));
  if (catalog.kind === "empty") {
    return catalog;
  }
  if (catalog.kind === "failed") {
    return { ...catalog, rows };
  }
  return rows.length === 0 ? { kind: "empty", rows: [] } : { kind: "ready", rows };
}

export function failedCatalogWithoutLoaded(
  catalog: SessionCatalogState,
  message: string,
): SessionCatalogState {
  return {
    kind: "failed",
    rows: catalog.rows.map((row) => ({ ...row, loaded: false })),
    message,
  };
}

export function catalogForLoadedSnapshot(
  catalog: SessionCatalogState,
  snapshot: DesktopSnapshot,
): SessionCatalogState {
  const sessionId = snapshot.session.summary.session_id;
  let found = false;
  const rows = catalog.rows.map((row) => {
    const loaded = row.session_id === sessionId;
    found ||= loaded;
    return { ...row, loaded };
  });
  if (!found) {
    const firstUserMessage = snapshot.session.items.find(
      (item) => item.kind === "user_message",
    );
    rows.unshift({
      session_id: sessionId,
      first_user_message_excerpt:
        firstUserMessage?.kind === "user_message" ? firstUserMessage.text : null,
      last_activity_at: snapshot.session.items.at(-1)?.base.at ?? null,
      loaded: true,
    });
  }
  return { kind: "ready", rows };
}

export function isTerminalTurnEvent(
  envelope: ReturnType<typeof parseDesktopMessageEnvelope>,
): boolean {
  return (
    envelope.payload.kind === "event" &&
    (envelope.payload.event.kind === "turn_completed" ||
      envelope.payload.event.kind === "turn_failed")
  );
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
