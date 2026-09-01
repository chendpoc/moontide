import {
  parseDesktopMessageEnvelope,
  type DesktopProtocolEvent,
  type DesktopResponse,
  type DesktopSnapshot,
} from "$lib/protocol/index.js";
import {
  createRenderState,
  reduceEnvelope,
} from "$lib/projection/renderState.js";
import type {
  DesktopBridge,
  DesktopControllerPort,
  DesktopViewState,
  SnapshotReplayResult,
  Subscriber,
  Unlisten,
} from "./type.js";
import {
  catalogForLoadedSnapshot,
  catalogWithoutLoaded,
  errorMessage,
  failedCatalogWithoutLoaded,
  isFirstSendInFlight,
  isTerminalTurnEvent,
  validateCatalogLoadedIdentity,
} from "./utils.js";

const DEFAULT_EVENT_BUFFER_CAPACITY = 256;

export class DesktopController implements DesktopControllerPort {
  readonly #bridge: DesktopBridge;
  readonly #eventBufferCapacity: number;
  readonly #subscribers = new Set<Subscriber>();
  #view: DesktopViewState = {
    connection: { kind: "starting" },
    catalog: { kind: "idle", rows: [] },
    firstSend: { kind: "idle" },
    render: createRenderState(),
  };
  #bufferedEvents: ReturnType<typeof parseDesktopMessageEnvelope>[] = [];
  #snapshotPending = false;
  #turnSubmissionPending = false;
  #turnStartedObserved = false;
  #lifecycleTask: Promise<void> | null = null;
  #resyncTask: Promise<void> | null = null;
  #unlisten: Unlisten[] = [];

  constructor(bridge: DesktopBridge, eventBufferCapacity = DEFAULT_EVENT_BUFFER_CAPACITY) {
    if (!Number.isInteger(eventBufferCapacity) || eventBufferCapacity <= 0) {
      throw new Error("Desktop event buffer capacity must be a positive integer");
    }
    this.#bridge = bridge;
    this.#eventBufferCapacity = eventBufferCapacity;
  }

  get state(): DesktopViewState {
    return this.#view;
  }

  subscribe(subscriber: Subscriber): () => void {
    this.#subscribers.add(subscriber);
    subscriber(this.#view);
    return () => this.#subscribers.delete(subscriber);
  }

  async start(): Promise<void> {
    if (this.#unlisten.length !== 0) {
      throw new Error("Desktop controller has already started");
    }
    try {
      const envelopeUnlisten = await this.#bridge.listenEnvelope((payload) => {
        this.#receiveEnvelope(payload);
      });
      this.#unlisten.push(envelopeUnlisten);
      const connectionUnlisten = await this.#bridge.listenConnection((payload) => {
        this.#receiveConnection(payload);
      });
      this.#unlisten.push(connectionUnlisten);

      await this.#refreshCatalog();
      if (this.#view.connection.kind === "starting") {
        this.#view = { ...this.#view, connection: { kind: "ready" } };
        this.#notify();
      }
    } catch (error) {
      this.#disconnect(errorMessage(error));
    }
  }

  newChat(): Promise<void> {
    return this.#runLifecycle(async () => {
      if (this.#view.render.session === null) {
        return;
      }
      this.#requireCloseGate();
      await this.#replaceRuntime();
    });
  }

  loadSession(sessionId: string): Promise<void> {
    return this.#runLifecycle(async () => {
      const normalized = sessionId.trim();
      if (normalized.length === 0) {
        throw new Error("Session id must not be empty");
      }
      if (this.#view.render.session?.summary.session_id === normalized) {
        return;
      }
      if (this.#view.render.session !== null) {
        this.#requireCloseGate();
        await this.#replaceRuntime();
        if (this.#view.render.session !== null || this.#view.connection.kind !== "ready") {
          return;
        }
      }
      await this.#startSession(normalized);
    });
  }

  retryRuntime(): Promise<void> {
    return this.#runLifecycle(async () => {
      if (
        this.#view.render.session !== null &&
        this.#view.connection.kind !== "degraded" &&
        this.#view.connection.kind !== "disconnected"
      ) {
        throw new Error("Cannot retry a healthy runtime while a Session is loaded");
      }
      await this.#replaceRuntime();
    });
  }

  async retryCatalog(): Promise<void> {
    if (this.#lifecycleTask !== null) {
      throw new Error("Cannot refresh the catalog during a Session lifecycle transition");
    }
    await this.#refreshCatalog();
  }

  async submitTurn(text: string): Promise<DesktopResponse> {
    if (this.#lifecycleTask !== null) {
      throw new Error("Cannot submit a Turn during a Session lifecycle transition");
    }
    if (text.trim().length === 0) {
      throw new Error("Cannot submit an empty Turn");
    }
    if (this.#turnSubmissionPending) {
      throw new Error("A Turn submission is already pending");
    }
    this.#turnSubmissionPending = true;
    this.#turnStartedObserved = false;
    try {
      const sessionId = this.#view.render.session?.summary.session_id;
      if (sessionId === undefined) {
        return await this.#submitFirstTurn(text);
      }
      const response = await this.#send(() => this.#bridge.submitTurn(sessionId, text));
      if (response.kind !== "turn_accepted") {
        this.#turnSubmissionPending = false;
      }
      return response;
    } catch (error) {
      this.#turnSubmissionPending = false;
      const firstSend =
        this.#view.render.session === null
          ? {
              kind: "awaiting_fresh_generation" as const,
              draftSnapshot: text,
              message: errorMessage(error),
            }
          : { kind: "idle" as const };
      this.#view = { ...this.#view, firstSend };
      this.#notify();
      throw error;
    }
  }

  async cancelTurn(): Promise<DesktopResponse> {
    return this.#send(() => this.#bridge.cancelTurn());
  }

  async approve(approvalId: string): Promise<DesktopResponse> {
    return this.#send(() => this.#bridge.approve(approvalId));
  }

  async deny(approvalId: string, reason: string): Promise<DesktopResponse> {
    return this.#send(() => this.#bridge.deny(approvalId, reason));
  }

  async whenSettled(): Promise<void> {
    await this.#resyncTask;
  }

  async dispose(): Promise<void> {
    const unlisten = this.#unlisten.splice(0);
    for (const dispose of unlisten) {
      await dispose();
    }
  }

  async #replaceRuntime(): Promise<void> {
    try {
      const response = await this.#bridge.newChat();
      if (response.kind === "generation_ready") {
        const render = createRenderState();
        render.delivery.connectionEpoch = response.connection_epoch;
        this.#view = {
          connection: { kind: "ready" },
          catalog: catalogWithoutLoaded(this.#view.catalog),
          firstSend: { kind: "idle" },
          render,
        };
        this.#notify();
        await this.#refreshCatalog();
        return;
      }
      if (response.kind === "rejected") {
        if (response.error.code === "generation_not_ready") {
          const render = createRenderState();
          this.#view = {
            connection: { kind: "disconnected", message: response.error.message },
            catalog: failedCatalogWithoutLoaded(this.#view.catalog, response.error.message),
            firstSend: { kind: "idle" },
            render,
          };
        } else {
          this.#view = {
            ...this.#view,
            connection: { kind: "degraded", message: response.error.message },
          };
        }
        this.#notify();
        return;
      }
      throw new Error(`Desktop response ${response.kind} did not match generation_ready`);
    } catch (error) {
      this.#disconnect(errorMessage(error));
    }
  }

  async #startSession(sessionId: string): Promise<void> {
    if (this.#view.connection.kind !== "ready") {
      return;
    }
    this.#snapshotPending = true;
    try {
      const ready = this.#expectResponse(
        await this.#bridge.startSession(sessionId),
        "session_ready",
      );
      if (ready.snapshot.session.summary.session_id !== sessionId) {
        throw new Error(
          `Desktop loaded Session ${ready.snapshot.session.summary.session_id} instead of ${sessionId}`,
        );
      }
      const replay = this.#bindSessionReady(ready.snapshot, ready.connection_epoch);
      if (replay.replayRequiresResync) {
        await this.#beginResync();
      } else if (replay.terminalRefreshRequired) {
        await this.#beginTerminalRefresh();
      }
      await this.#refreshCatalog();
    } catch (error) {
      this.#snapshotPending = false;
      this.#bufferedEvents = [];
      const render = createRenderState();
      render.delivery.connectionEpoch = this.#view.render.delivery.connectionEpoch;
      this.#view = {
        ...this.#view,
        connection: { kind: "disconnected", message: errorMessage(error) },
        firstSend: { kind: "idle" },
        render,
      };
      this.#notify();
    }
  }

  async #submitFirstTurn(text: string): Promise<DesktopResponse> {
    if (this.#view.connection.kind !== "ready") {
      throw new Error("Desktop connection is not ready");
    }
    this.#view = {
      ...this.#view,
      firstSend: { kind: "creating_session", draftSnapshot: text },
    };
    this.#snapshotPending = true;
    this.#notify();

    const created = await this.#request(() => this.#bridge.createSession());
    if (created.kind === "rejected") {
      this.#snapshotPending = false;
      this.#bufferedEvents = [];
      this.#turnSubmissionPending = false;
      this.#applyResponse(created);
      this.#view = {
        ...this.#view,
        connection: { kind: "disconnected", message: created.error.message },
        firstSend: {
          kind: "awaiting_fresh_generation",
          draftSnapshot: text,
          message: created.error.message,
        },
      };
      this.#notify();
      return created;
    }
    if (created.kind !== "session_ready") {
      const message = `Desktop response ${created.kind} did not match session_ready`;
      this.#disconnect(message);
      throw new Error(message);
    }
    const sessionId = created.snapshot.session.summary.session_id;
    if (sessionId.trim().length === 0) {
      const message = "Desktop created a Session without an identity";
      this.#disconnect(message);
      throw new Error(message);
    }

    const replay = this.#bindSessionReady(created.snapshot, created.connection_epoch);
    this.#turnSubmissionPending = true;
    if (replay.replayRequiresResync) {
      await this.#beginResync();
    } else if (replay.terminalRefreshRequired) {
      await this.#beginTerminalRefresh();
    }
    this.#requireFirstSendBaseline(sessionId);
    this.#view = {
      ...this.#view,
      firstSend: {
        kind: "submitting_first_turn",
        draftSnapshot: text,
        sessionId,
      },
    };
    this.#notify();

    const submitted = await this.#send(() => this.#bridge.submitTurn(sessionId, text));
    if (submitted.kind !== "turn_accepted") {
      this.#turnSubmissionPending = false;
    } else if (this.#turnStartedObserved) {
      this.#turnSubmissionPending = false;
    }
    this.#view = { ...this.#view, firstSend: { kind: "idle" } };
    this.#notify();
    return submitted;
  }

  #bindSessionReady(
    snapshot: DesktopSnapshot,
    connectionEpoch: number,
  ): SnapshotReplayResult {
    const replay = this.#establishSnapshot(snapshot, connectionEpoch);
    this.#view = {
      ...this.#view,
      catalog: catalogForLoadedSnapshot(this.#view.catalog, snapshot),
    };
    this.#notify();
    return replay;
  }

  #requireFirstSendBaseline(sessionId: string): void {
    if (this.#view.connection.kind !== "ready") {
      throw new Error("Desktop connection is not ready after Session creation");
    }
    if (
      this.#view.render.delivery.awaitingSnapshot ||
      this.#view.render.delivery.resyncRequired
    ) {
      throw new Error("Desktop Session creation baseline still requires resync");
    }
    const loadedSessionId = this.#view.render.session?.summary.session_id;
    if (loadedSessionId !== sessionId) {
      const message = `Desktop created Session ${sessionId} but established ${loadedSessionId ?? "no Session"}`;
      this.#disconnect(message);
      throw new Error(message);
    }
  }

  async #refreshCatalog(): Promise<void> {
    const requestedEpoch = this.#view.render.delivery.connectionEpoch;
    const requestedSessionId = this.#view.render.session?.summary.session_id;
    const previous = this.#view.catalog.rows;
    this.#view = {
      ...this.#view,
      catalog: { kind: "listing", rows: previous },
    };
    this.#notify();
    try {
      const response = await this.#bridge.listSessions();
      const currentEpoch = this.#view.render.delivery.connectionEpoch;
      const currentSessionId = this.#view.render.session?.summary.session_id;
      if (currentEpoch !== requestedEpoch || currentSessionId !== requestedSessionId) {
        return;
      }
      if (response.kind === "rejected") {
        this.#view = {
          ...this.#view,
          catalog: { kind: "failed", rows: previous, message: response.error.message },
        };
      } else if (response.kind === "session_catalog_listed") {
        if (currentEpoch !== null && response.connection_epoch !== currentEpoch) {
          throw new Error(
            `Desktop catalog epoch ${response.connection_epoch} does not match runtime epoch ${currentEpoch}`,
          );
        }
        if (currentEpoch === null) {
          this.#view.render.delivery.connectionEpoch = response.connection_epoch;
        }
        validateCatalogLoadedIdentity(response.rows, this.#view.render.session?.summary.session_id);
        this.#view = {
          ...this.#view,
          catalog:
            response.rows.length === 0
              ? { kind: "empty", rows: [] }
              : { kind: "ready", rows: response.rows },
        };
        if (this.#view.connection.kind === "starting") {
          this.#view = { ...this.#view, connection: { kind: "ready" } };
        }
      } else {
        throw new Error(`Desktop response ${response.kind} did not match session_catalog_listed`);
      }
      this.#notify();
    } catch (error) {
      const message = errorMessage(error);
      this.#view = {
        ...this.#view,
        catalog: { kind: "failed", rows: previous, message },
      };
      this.#notify();
      if (this.#view.connection.kind === "starting") {
        this.#disconnect(message);
      }
    }
  }

  #requireCloseGate(): void {
    const run = this.#view.render.run;
    const runKind = typeof run === "string" ? run : Object.keys(run)[0];
    if (
      this.#view.connection.kind !== "ready" ||
      !["idle", "failed"].includes(runKind ?? "") ||
      Object.keys(this.#view.render.approvals).length !== 0 ||
      this.#turnSubmissionPending ||
      this.#view.render.delivery.awaitingSnapshot ||
      this.#view.render.delivery.resyncRequired
    ) {
      throw new Error("Current Session must settle before it can be closed");
    }
  }

  async #send(request: () => Promise<DesktopResponse>): Promise<DesktopResponse> {
    const response = await this.#request(request);
    try {
      this.#applyResponse(response);
    } catch (error) {
      const message = errorMessage(error);
      this.#disconnect(message);
      throw new Error(message);
    }
    return response;
  }

  async #request(request: () => Promise<DesktopResponse>): Promise<DesktopResponse> {
    if (this.#view.connection.kind !== "ready") {
      throw new Error("Desktop connection is not ready");
    }

    try {
      return await request();
    } catch (error) {
      const message = errorMessage(error);
      this.#disconnect(message);
      throw new Error(message);
    }
  }

  #applyResponse(response: DesktopResponse): void {
    const output = reduceEnvelope(this.#view.render, {
      protocol_version: 1,
      connection_epoch: null,
      request_id: null,
      seq: null,
      payload: { kind: "response", response },
    });
    this.#view = { ...this.#view, render: output.state };
    this.#notify();
  }

  #receiveEnvelope(payload: unknown): void {
    if (this.#view.connection.kind === "disconnected") {
      return;
    }
    let envelope: ReturnType<typeof parseDesktopMessageEnvelope>;
    try {
      envelope = parseDesktopMessageEnvelope(payload);
    } catch (error) {
      this.#disconnect(`invalid Desktop envelope: ${errorMessage(error)}`);
      return;
    }
    if (envelope.payload.kind !== "event") {
      this.#disconnect("Desktop event channel delivered a non-event envelope");
      return;
    }
    if (this.#snapshotPending) {
      this.#bufferEvent(envelope);
      return;
    }

    if (isTerminalTurnEvent(envelope)) {
      if (!this.#bufferEvent(envelope)) {
        return;
      }
      void this.#beginTerminalRefresh();
      return;
    }

    const output = reduceEnvelope(this.#view.render, envelope);
    this.#view = { ...this.#view, render: output.state };
    if (output.result === "applied" && envelope.payload.event.kind === "turn_started") {
      this.#recordTurnStarted();
    }
    this.#notify();
    if (output.result === "resync_required") {
      if (!this.#bufferEvent(envelope)) {
        return;
      }
      void this.#beginResync();
    }
  }

  #receiveConnection(payload: unknown): void {
    if (
      typeof payload === "object" &&
      payload !== null &&
      "kind" in payload &&
      payload.kind === "degraded_shutdown"
    ) {
      const message =
        "message" in payload && typeof payload.message === "string"
          ? payload.message
          : "Desktop shutdown degraded";
      this.#view = { ...this.#view, connection: { kind: "degraded", message } };
      this.#notify();
      return;
    }
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "message" in payload &&
      typeof payload.message === "string"
        ? payload.message
        : "Desktop connection closed";
    this.#disconnect(message);
  }

  #bufferEvent(envelope: ReturnType<typeof parseDesktopMessageEnvelope>): boolean {
    if (this.#bufferedEvents.length >= this.#eventBufferCapacity) {
      this.#disconnect("Desktop event buffer overflowed while awaiting snapshot");
      return false;
    }
    this.#bufferedEvents.push(envelope);
    return true;
  }

  async #beginResync(): Promise<void> {
    return this.#beginSnapshot("resync");
  }

  async #beginTerminalRefresh(): Promise<void> {
    return this.#beginSnapshot("terminal refresh");
  }

  async #beginSnapshot(reason: "resync" | "terminal refresh"): Promise<void> {
    if (this.#view.connection.kind === "disconnected") {
      return;
    }
    if (this.#snapshotPending && this.#resyncTask !== null) {
      return this.#resyncTask;
    }

    this.#snapshotPending = true;
    const task = (async () => {
      let terminalRefreshRequired = false;
      try {
        const snapshotResponse = this.#expectResponse(
          await this.#bridge.snapshot(),
          "snapshot",
        );
        const replay = this.#establishSnapshot(
          snapshotResponse.snapshot,
          snapshotResponse.connection_epoch,
        );
        terminalRefreshRequired = replay.terminalRefreshRequired;
        if (replay.replayRequiresResync) {
          this.#disconnect(`Desktop ${reason} baseline did not close the delivery gap`);
        }
      } catch (error) {
        this.#disconnect(`Desktop ${reason} failed: ${errorMessage(error)}`);
      } finally {
        this.#resyncTask = null;
      }
      if (terminalRefreshRequired && this.#view.connection.kind !== "disconnected") {
        await this.#beginTerminalRefresh();
      }
    })();
    this.#resyncTask = task;
    return task;
  }

  #establishSnapshot(snapshot: DesktopSnapshot, connectionEpoch: number): SnapshotReplayResult {
    const output = reduceEnvelope(this.#view.render, {
      protocol_version: 1,
      connection_epoch: connectionEpoch,
      request_id: null,
      seq: null,
      payload: {
        kind: "response",
        response: { kind: "session_ready", connection_epoch: connectionEpoch, snapshot },
      },
    });
    this.#view = { ...this.#view, render: output.state };
    if (!isFirstSendInFlight(this.#view.firstSend)) {
      this.#turnSubmissionPending = false;
    }
    const buffered = this.#bufferedEvents;
    this.#bufferedEvents = [];
    this.#snapshotPending = false;

    let requiresResync = false;
    let terminalRefreshRequired = false;
    for (const event of buffered) {
      const output = reduceEnvelope(this.#view.render, event);
      this.#view = { ...this.#view, render: output.state };
      if (
        output.result === "applied" &&
        event.payload.kind === "event" &&
        event.payload.event.kind === "turn_started"
      ) {
        this.#recordTurnStarted();
      }
      if (output.result === "resync_required") {
        requiresResync = true;
        break;
      }
      if (output.result === "applied" && isTerminalTurnEvent(event)) {
        terminalRefreshRequired = true;
      }
    }
    this.#notify();
    return {
      replayRequiresResync: requiresResync,
      terminalRefreshRequired,
    };
  }

  #expectResponse<T extends DesktopResponse["kind"]>(
    response: DesktopResponse,
    expected: T,
  ): Extract<DesktopResponse, { kind: T }> {
    if (response.kind === "rejected") {
      throw new Error(response.error.message);
    }
    if (response.kind !== expected) {
      throw new Error(`Desktop response ${response.kind} did not match ${expected}`);
    }
    return response as Extract<DesktopResponse, { kind: T }>;
  }

  #disconnect(message: string): void {
    if (this.#view.connection.kind === "disconnected") {
      return;
    }
    this.#snapshotPending = false;
    this.#turnSubmissionPending = false;
    this.#turnStartedObserved = false;
    this.#bufferedEvents = [];
    this.#view = { ...this.#view, connection: { kind: "disconnected", message } };
    this.#notify();
  }

  #notify(): void {
    for (const subscriber of this.#subscribers) {
      subscriber(this.#view);
    }
  }

  #recordTurnStarted(): void {
    this.#turnStartedObserved = true;
    if (!isFirstSendInFlight(this.#view.firstSend)) {
      this.#turnSubmissionPending = false;
    }
  }

  async #runLifecycle(operation: () => Promise<void>): Promise<void> {
    if (this.#lifecycleTask !== null) {
      throw new Error("A Session lifecycle transition is already in progress");
    }
    if (this.#turnSubmissionPending || isFirstSendInFlight(this.#view.firstSend)) {
      throw new Error("Cannot change Session lifecycle while a Turn submission is pending");
    }
    const task = operation();
    this.#lifecycleTask = task;
    try {
      await task;
    } finally {
      if (this.#lifecycleTask === task) {
        this.#lifecycleTask = null;
      }
    }
  }
}

export type { DesktopProtocolEvent };
