import type { DesktopResponse, SessionCatalogRow } from "$lib/protocol/index.js";
import type { RenderState } from "$lib/projection/renderState.js";

export type Unlisten = () => void | Promise<void>;

export interface DesktopBridge {
    listSessions(): Promise<DesktopResponse>;
    newChat(): Promise<DesktopResponse>;
    createSession(): Promise<DesktopResponse>;
    startSession(sessionId: string): Promise<DesktopResponse>;
    loadSessionHistory(sessionId: string, beforeTurn: number, limit: number): Promise<DesktopResponse>;
    submitTurn(sessionId: string, text: string): Promise<DesktopResponse>;
    cancelTurn(): Promise<DesktopResponse>;
    approve(approvalId: string): Promise<DesktopResponse>;
    deny(approvalId: string, reason: string): Promise<DesktopResponse>;
    snapshot(): Promise<DesktopResponse>;
    shutdown(): Promise<DesktopResponse>;
    listenEnvelope(listener: (payload: unknown) => void): Promise<Unlisten>;
    listenConnection(listener: (payload: unknown) => void): Promise<Unlisten>;
}

export type ConnectionState =
    | { kind: "starting" }
    | { kind: "ready" }
    | { kind: "degraded"; message: string }
    | { kind: "disconnected"; message: string };

export interface DesktopViewState {
    connection: ConnectionState;
    catalog: SessionCatalogState;
    firstSend: FirstSendState;
    render: RenderState;
}

export type FirstSendState =
    | { kind: "idle" }
    | { kind: "creating_session"; draftSnapshot: string }
    | { kind: "submitting_first_turn"; draftSnapshot: string; sessionId: string }
    | { kind: "awaiting_fresh_generation"; draftSnapshot: string; message: string };

export type SessionCatalogState =
    | { kind: "idle"; rows: SessionCatalogRow[] }
    | { kind: "listing"; rows: SessionCatalogRow[] }
    | { kind: "ready"; rows: SessionCatalogRow[] }
    | { kind: "empty"; rows: [] }
    | { kind: "failed"; rows: SessionCatalogRow[]; message: string };

export type Subscriber = (state: DesktopViewState) => void;

export interface SnapshotReplayResult {
    replayRequiresResync: boolean;
    terminalRefreshRequired: boolean;
}

export interface DesktopControllerPort {
    readonly state: DesktopViewState;
    subscribe(subscriber: Subscriber): () => void;
    start(): Promise<void>;
    newChat(): Promise<void>;
    loadSession(sessionId: string): Promise<void>;
    loadOlderHistory(): Promise<void>;
    retryRuntime(): Promise<void>;
    retryCatalog(): Promise<void>;
    submitTurn(text: string): Promise<DesktopResponse>;
    cancelTurn(): Promise<DesktopResponse>;
    approve(approvalId: string): Promise<DesktopResponse>;
    deny(approvalId: string, reason: string): Promise<DesktopResponse>;
    dispose(): Promise<void>;
}
