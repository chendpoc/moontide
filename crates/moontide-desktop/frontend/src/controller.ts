import {
  parseDesktopMessageEnvelope,
  type DesktopCommand,
  type DesktopMessageEnvelope,
  type DesktopResponse,
} from "./protocol";
import {
  createRenderState,
  reduceEnvelope,
  type RenderState,
} from "./renderState";

export type Unlisten = () => void | Promise<void>;

export interface DesktopBridge {
  request(command: DesktopCommand): Promise<unknown>;
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
  render: RenderState;
}

type Subscriber = (state: DesktopViewState) => void;

interface SnapshotReplayResult {
  replayRequiresResync: boolean;
  terminalRefreshRequired: boolean;
}

export interface DesktopControllerPort {
  readonly state: DesktopViewState;
  subscribe(subscriber: Subscriber): () => void;
  start(
    selection?: Extract<DesktopCommand, { kind: "start_session" }>["selection"],
  ): Promise<void>;
  send(command: DesktopCommand): Promise<DesktopResponse>;
  dispose(): Promise<void>;
}

const DEFAULT_EVENT_BUFFER_CAPACITY = 256;

export class DesktopController implements DesktopControllerPort {
  readonly #bridge: DesktopBridge;
  readonly #eventBufferCapacity: number;
  readonly #subscribers = new Set<Subscriber>();
  #view: DesktopViewState = {
    connection: { kind: "starting" },
    render: createRenderState(),
  };
  #bufferedEvents: DesktopMessageEnvelope[] = [];
  #snapshotPending = false;
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

  async start(selection: Extract<DesktopCommand, { kind: "start_session" }>["selection"] = {
    kind: "new",
  }): Promise<void> {
    if (this.#unlisten.length !== 0) {
      throw new Error("Desktop controller has already started");
    }
    this.#snapshotPending = true;
    try {
      const envelopeUnlisten = await this.#bridge.listenEnvelope((payload) => {
        this.#receiveEnvelope(payload);
      });
      this.#unlisten.push(envelopeUnlisten);
      const connectionUnlisten = await this.#bridge.listenConnection((payload) => {
        this.#receiveConnection(payload);
      });
      this.#unlisten.push(connectionUnlisten);

      const handshake = await this.#request({ kind: "handshake" });
      this.#expectResponse(handshake, "handshake_accepted");
      this.#applyEnvelope(handshake);

      const ready = await this.#request({ kind: "start_session", selection });
      this.#expectResponse(ready, "session_ready");
      const replay = this.#establishSnapshot(ready);
      if (replay.replayRequiresResync) {
        await this.#beginResync();
      } else if (replay.terminalRefreshRequired) {
        await this.#beginTerminalRefresh();
      }
      if (this.#view.connection.kind === "starting") {
        this.#view = { ...this.#view, connection: { kind: "ready" } };
        this.#notify();
      }
    } catch (error) {
      this.#disconnect(errorMessage(error));
    }
  }

  async send(command: DesktopCommand): Promise<DesktopResponse> {
    if (this.#view.connection.kind !== "ready") {
      throw new Error("Desktop connection is not ready");
    }
    if (
      command.kind === "handshake" ||
      command.kind === "start_session" ||
      command.kind === "snapshot"
    ) {
      throw new Error("Desktop boot and snapshot commands are owned by the controller");
    }

    try {
      const envelope = await this.#request(command);
      const response = this.#response(envelope);
      this.#applyEnvelope(envelope);
      return response;
    } catch (error) {
      const message = errorMessage(error);
      this.#disconnect(message);
      throw new Error(message);
    }
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

  async #request(command: DesktopCommand): Promise<DesktopMessageEnvelope> {
    return parseDesktopMessageEnvelope(await this.#bridge.request(command));
  }

  #receiveEnvelope(payload: unknown): void {
    if (this.#view.connection.kind === "disconnected") {
      return;
    }
    let envelope: DesktopMessageEnvelope;
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

  #bufferEvent(envelope: DesktopMessageEnvelope): boolean {
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
        const snapshot = await this.#request({ kind: "snapshot" });
        this.#expectResponse(snapshot, "snapshot");
        const replay = this.#establishSnapshot(snapshot);
        terminalRefreshRequired = replay.terminalRefreshRequired;
        if (replay.replayRequiresResync) {
          this.#disconnect(`Desktop ${reason} baseline did not close the delivery gap`);
        }
      } catch (error) {
        this.#disconnect(`Desktop ${reason} failed: ${errorMessage(error)}`);
      } finally {
        this.#resyncTask = null;
      }
      if (
        terminalRefreshRequired &&
        this.#view.connection.kind !== "disconnected"
      ) {
        await this.#beginTerminalRefresh();
      }
    })();
    this.#resyncTask = task;
    return task;
  }

  #establishSnapshot(envelope: DesktopMessageEnvelope): SnapshotReplayResult {
    this.#applyEnvelope(envelope);
    const buffered = this.#bufferedEvents;
    this.#bufferedEvents = [];
    this.#snapshotPending = false;

    let requiresResync = false;
    let terminalRefreshRequired = false;
    for (const event of buffered) {
      const output = reduceEnvelope(this.#view.render, event);
      this.#view = { ...this.#view, render: output.state };
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

  #applyEnvelope(envelope: DesktopMessageEnvelope): void {
    const output = reduceEnvelope(this.#view.render, envelope);
    this.#view = { ...this.#view, render: output.state };
    this.#notify();
  }

  #response(envelope: DesktopMessageEnvelope): DesktopResponse {
    if (envelope.payload.kind !== "response") {
      throw new Error("Desktop bridge returned a non-response envelope");
    }
    return envelope.payload.response;
  }

  #expectResponse(envelope: DesktopMessageEnvelope, expected: DesktopResponse["kind"]): void {
    const response = this.#response(envelope);
    if (response.kind === "rejected") {
      throw new Error(response.error.message);
    }
    if (response.kind !== expected) {
      throw new Error(`Desktop response ${response.kind} did not match ${expected}`);
    }
  }

  #disconnect(message: string): void {
    if (this.#view.connection.kind === "disconnected") {
      return;
    }
    this.#snapshotPending = false;
    this.#bufferedEvents = [];
    this.#view = { ...this.#view, connection: { kind: "disconnected", message } };
    this.#notify();
  }

  #notify(): void {
    for (const subscriber of this.#subscribers) {
      subscriber(this.#view);
    }
  }
}

function isTerminalTurnEvent(envelope: DesktopMessageEnvelope): boolean {
  return (
    envelope.payload.kind === "event" &&
    (envelope.payload.event.kind === "turn_completed" ||
      envelope.payload.event.kind === "turn_failed")
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
