import { describe, expect, it } from "vitest";

import { DesktopController, type DesktopBridge, type Unlisten } from "$lib/controller/index.js";
import {
  parseDesktopMessageEnvelope,
  type DesktopProtocolEvent,
  type DesktopResponse,
  type DesktopSnapshot,
} from "$lib/protocol/index.js";

function snapshot(lastSeq = 0): DesktopSnapshot {
  return {
    session: {
      summary: {
        session_id: "session-1",
        cwd: ".",
        last_turn: null,
        item_count: 0,
      },
      items: [],
    },
    state: "idle",
    pending_approvals: [],
    active_assistant_calls: [],
    delivery: {
      last_delivered_seq: lastSeq,
      resync_required: false,
      dropped_snapshots: 0,
      buffered_events: 0,
    },
  };
}

function completedSnapshot(lastSeq: number, text: string): DesktopSnapshot {
  return {
    ...snapshot(lastSeq),
    session: {
      summary: {
        session_id: "session-1",
        cwd: ".",
        last_turn: 0,
        item_count: 1,
      },
      items: [
        {
          kind: "user_message",
          base: {
            id: "item-1",
            seq: 0,
            session_id: "session-1",
            turn: 0,
            at: "2026-08-25T00:00:00Z",
          },
          text,
        },
      ],
    },
  };
}

function event(seq: number, payload: DesktopProtocolEvent, epoch = 1): unknown {
  return parseDesktopMessageEnvelope({
    protocol_version: 1,
    connection_epoch: epoch,
    request_id: null,
    seq,
    payload: { kind: "event", event: payload },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

class FakeBridge implements DesktopBridge {
  readonly operations: string[] = [];
  readonly snapshotCalls: number[] = [];
  readonly startedSessionIds: string[] = [];
  readonly submitCalls: Array<{ sessionId: string; text: string }> = [];
  currentEpoch = 1;
  loadedSessionId: string | null = null;
  listSessionsHandler: (() => Promise<DesktopResponse>) | null = null;
  newChatHandler: () => Promise<DesktopResponse> = async () => ({
    kind: "generation_ready",
    connection_epoch: 2,
  });
  createSessionHandler: () => Promise<DesktopResponse> = async () => ({
    kind: "session_ready",
    connection_epoch: 1,
    snapshot: snapshot(),
  });
  startSessionHandler: (sessionId: string) => Promise<DesktopResponse> = async () => ({
    kind: "session_ready",
    connection_epoch: 1,
    snapshot: snapshot(),
  });
  snapshotHandler: () => Promise<DesktopResponse> = async () => ({
    kind: "snapshot",
    connection_epoch: 1,
    snapshot: snapshot(),
  });
  submitTurnHandler: (
    sessionId: string,
    text: string,
  ) => Promise<DesktopResponse> = async () => ({
    kind: "turn_accepted",
    turn: 0,
  });
  #envelopeListener: ((payload: unknown) => void) | null = null;
  #connectionListener: ((payload: unknown) => void) | null = null;

  async listSessions(): Promise<DesktopResponse> {
    this.operations.push("listSessions");
    if (this.listSessionsHandler !== null) {
      return this.listSessionsHandler();
    }
    return {
      kind: "session_catalog_listed",
      connection_epoch: this.currentEpoch,
      rows:
        this.loadedSessionId === null
          ? []
          : [
              {
                session_id: this.loadedSessionId,
                first_user_message_excerpt: null,
                last_activity_at: null,
                loaded: true,
              },
            ],
    };
  }

  async newChat(): Promise<DesktopResponse> {
    this.operations.push("newChat");
    const response = await this.newChatHandler();
    if (response.kind === "generation_ready") {
      this.currentEpoch = response.connection_epoch;
      this.loadedSessionId = null;
    }
    return response;
  }

  async createSession(): Promise<DesktopResponse> {
    this.operations.push("createSession");
    const response = await this.createSessionHandler();
    if (response.kind === "session_ready") {
      this.loadedSessionId = response.snapshot.session.summary.session_id;
    }
    return response;
  }

  async startSession(sessionId: string): Promise<DesktopResponse> {
    this.operations.push("startSession");
    this.startedSessionIds.push(sessionId);
    const response = await this.startSessionHandler(sessionId);
    if (response.kind === "session_ready") {
      this.loadedSessionId = response.snapshot.session.summary.session_id;
    }
    return response;
  }

  async submitTurn(sessionId: string, text: string): Promise<DesktopResponse> {
    this.operations.push("submitTurn");
    this.submitCalls.push({ sessionId, text });
    return this.submitTurnHandler(sessionId, text);
  }

  async cancelTurn(): Promise<DesktopResponse> {
    this.operations.push("cancelTurn");
    return { kind: "cancellation_accepted", turn: 0 };
  }

  async approve(approvalId: string): Promise<DesktopResponse> {
    this.operations.push(`approve:${approvalId}`);
    return { kind: "approval_accepted", approval_id: approvalId };
  }

  async deny(approvalId: string, reason: string): Promise<DesktopResponse> {
    this.operations.push(`deny:${approvalId}:${reason}`);
    return { kind: "approval_accepted", approval_id: approvalId };
  }

  async snapshot(): Promise<DesktopResponse> {
    this.operations.push("snapshot");
    this.snapshotCalls.push(this.snapshotCalls.length + 1);
    return this.snapshotHandler();
  }

  async shutdown(): Promise<DesktopResponse> {
    this.operations.push("shutdown");
    return {
      kind: "shutdown_completed",
      report: {
        cancelled_turn: null,
        progress_flushed: true,
        diagnostic_log_flushed: true,
      },
    };
  }

  async listenEnvelope(listener: (payload: unknown) => void): Promise<Unlisten> {
    this.operations.push("listen:envelope");
    this.#envelopeListener = listener;
    return () => {
      this.#envelopeListener = null;
    };
  }

  async listenConnection(listener: (payload: unknown) => void): Promise<Unlisten> {
    this.operations.push("listen:connection");
    this.#connectionListener = listener;
    return () => {
      this.#connectionListener = null;
    };
  }

  emitEnvelope(payload: unknown): void {
    this.#envelopeListener?.(payload);
  }

  emitConnection(payload: unknown): void {
    this.#connectionListener?.(payload);
  }
}

async function startLoaded(controller: DesktopController): Promise<void> {
  await controller.start();
  await controller.loadSession("session-1");
}

describe("DesktopController Session lifecycle", () => {
  it("boots Blank and lists an empty catalog without creating a Session", async () => {
    const bridge = new FakeBridge();
    const controller = new DesktopController(bridge);

    await controller.start();

    expect(bridge.operations).toEqual([
      "listen:envelope",
      "listen:connection",
      "listSessions",
    ]);
    expect(controller.state.connection).toEqual({ kind: "ready" });
    expect(controller.state.catalog).toEqual({ kind: "empty", rows: [] });
    expect(controller.state.render.session).toBeNull();
  });

  it("creates one Session before submitting the exact first draft to its identity", async () => {
    const bridge = new FakeBridge();
    const created = snapshot();
    created.session.summary.session_id = "created-session";
    bridge.createSessionHandler = async () => ({
      kind: "session_ready",
      connection_epoch: 1,
      snapshot: created,
    });
    const controller = new DesktopController(bridge);
    const firstSendKinds: string[] = [];
    controller.subscribe((state) => firstSendKinds.push(state.firstSend.kind));
    await controller.start();

    const response = await controller.submitTurn("  exact first draft  ");

    expect(response).toEqual({ kind: "turn_accepted", turn: 0 });
    expect(bridge.submitCalls).toEqual([
      { sessionId: "created-session", text: "  exact first draft  " },
    ]);
    expect(bridge.operations.indexOf("createSession")).toBeLessThan(
      bridge.operations.indexOf("submitTurn"),
    );
    expect(bridge.operations.filter((operation) => operation === "createSession")).toHaveLength(
      1,
    );
    expect(firstSendKinds).toContain("creating_session");
    expect(firstSendKinds).toContain("submitting_first_turn");
    expect(controller.state.firstSend).toEqual({ kind: "idle" });
    expect(controller.state.render.session?.summary.session_id).toBe("created-session");
  });

  it("does not duplicate first Send while Session creation is pending", async () => {
    const bridge = new FakeBridge();
    const pendingCreate = deferred<DesktopResponse>();
    bridge.createSessionHandler = async () => pendingCreate.promise;
    const controller = new DesktopController(bridge);
    await controller.start();

    const first = controller.submitTurn("first");
    await Promise.resolve();
    bridge.emitEnvelope(event(1, { kind: "turn_started", turn: 99 }, 0));
    await expect(controller.submitTurn("duplicate")).rejects.toThrow(
      "A Turn submission is already pending",
    );
    await expect(controller.loadSession("session-2")).rejects.toThrow(
      "Cannot change Session lifecycle while a Turn submission is pending",
    );
    await expect(controller.retryRuntime()).rejects.toThrow(
      "Cannot change Session lifecycle while a Turn submission is pending",
    );
    await expect(controller.newChat()).rejects.toThrow(
      "Cannot change Session lifecycle while a Turn submission is pending",
    );
    expect(bridge.operations.filter((operation) => operation === "createSession")).toHaveLength(
      1,
    );
    expect(bridge.operations).not.toContain("startSession");
    expect(bridge.operations).not.toContain("newChat");

    pendingCreate.resolve({
      kind: "session_ready",
      connection_epoch: 1,
      snapshot: snapshot(),
    });
    await first;
    expect(bridge.submitCalls).toEqual([{ sessionId: "session-1", text: "first" }]);
    await expect(controller.newChat()).rejects.toThrow(
      "Cannot change Session lifecycle while a Turn submission is pending",
    );
  });

  it("buffers creation events until SessionReady establishes their snapshot baseline", async () => {
    const bridge = new FakeBridge();
    bridge.createSessionHandler = async () => {
      bridge.emitEnvelope(event(1, { kind: "turn_started", turn: 9 }));
      return { kind: "session_ready", connection_epoch: 1, snapshot: snapshot(1) };
    };
    const controller = new DesktopController(bridge);
    await controller.start();

    await controller.submitTurn("first");

    expect(controller.state.connection).toEqual({ kind: "ready" });
    expect(controller.state.render.delivery.lastSeq).toBe(1);
    expect(controller.state.render.run).toBe("idle");
    expect(bridge.submitCalls).toEqual([{ sessionId: "session-1", text: "first" }]);
  });

  it("resyncs a creation delivery gap before submitting the first Turn", async () => {
    const bridge = new FakeBridge();
    bridge.createSessionHandler = async () => {
      bridge.emitEnvelope(event(2, { kind: "turn_started", turn: 9 }));
      return { kind: "session_ready", connection_epoch: 1, snapshot: snapshot() };
    };
    bridge.snapshotHandler = async () => ({
      kind: "snapshot",
      connection_epoch: 1,
      snapshot: snapshot(2),
    });
    const controller = new DesktopController(bridge);
    await controller.start();

    await controller.submitTurn("after resync");

    expect(bridge.operations.indexOf("snapshot")).toBeLessThan(
      bridge.operations.indexOf("submitTurn"),
    );
    expect(controller.state.render.delivery.resyncRequired).toBe(false);
    expect(bridge.submitCalls).toEqual([
      { sessionId: "session-1", text: "after resync" },
    ]);
  });

  it("ignores a Blank catalog result that resolves after first Send loads a Session", async () => {
    const bridge = new FakeBridge();
    const delayedCatalog = deferred<DesktopResponse>();
    const controller = new DesktopController(bridge);
    await controller.start();
    bridge.listSessionsHandler = async () => delayedCatalog.promise;

    const catalogRefresh = controller.retryCatalog();
    await Promise.resolve();
    await controller.submitTurn("first");
    delayedCatalog.resolve({
      kind: "session_catalog_listed",
      connection_epoch: 1,
      rows: [],
    });
    await catalogRefresh;

    expect(controller.state.catalog.rows).toEqual([
      {
        session_id: "session-1",
        first_user_message_excerpt: null,
        last_activity_at: null,
        loaded: true,
      },
    ]);
    expect(controller.state.render.session?.summary.session_id).toBe("session-1");
  });

  it("keeps Blank and requires a fresh generation after create rejection", async () => {
    const bridge = new FakeBridge();
    bridge.createSessionHandler = async () => ({
      kind: "rejected",
      error: { code: "session_start_failed", message: "could not create Session" },
    });
    const controller = new DesktopController(bridge);
    await controller.start();

    const response = await controller.submitTurn("preserve me");

    expect(response.kind).toBe("rejected");
    expect(controller.state.render.session).toBeNull();
    expect(controller.state.connection).toEqual({
      kind: "disconnected",
      message: "could not create Session",
    });
    expect(controller.state.firstSend).toEqual({
      kind: "awaiting_fresh_generation",
      draftSnapshot: "preserve me",
      message: "could not create Session",
    });
    expect(bridge.submitCalls).toEqual([]);
  });

  it("keeps the created Session loaded when the first Turn is rejected", async () => {
    const bridge = new FakeBridge();
    bridge.submitTurnHandler = async () => ({
      kind: "rejected",
      error: { code: "busy", message: "host busy" },
    });
    const controller = new DesktopController(bridge);
    await controller.start();

    const response = await controller.submitTurn("try once");

    expect(response.kind).toBe("rejected");
    expect(controller.state.connection).toEqual({ kind: "ready" });
    expect(controller.state.render.session?.summary.session_id).toBe("session-1");
    expect(controller.state.firstSend).toEqual({ kind: "idle" });
    expect(bridge.submitCalls).toEqual([{ sessionId: "session-1", text: "try once" }]);
  });

  it("loads the selected historical Session before submitTurn can continue it", async () => {
    const bridge = new FakeBridge();
    const controller = new DesktopController(bridge);
    await controller.start();

    await controller.loadSession("session-1");
    await controller.submitTurn("continue the history");

    expect(bridge.startedSessionIds).toEqual(["session-1"]);
    expect(bridge.submitCalls).toEqual([
      { sessionId: "session-1", text: "continue the history" },
    ]);
    expect(bridge.operations.indexOf("startSession")).toBeLessThan(
      bridge.operations.indexOf("submitTurn"),
    );
    expect(controller.state.render.session?.summary.session_id).toBe("session-1");
  });

  it("allows only one Session load transaction at a time", async () => {
    const bridge = new FakeBridge();
    const pendingStart = deferred<DesktopResponse>();
    bridge.startSessionHandler = async () => pendingStart.promise;
    const controller = new DesktopController(bridge);
    await controller.start();

    const firstLoad = controller.loadSession("session-1");
    await Promise.resolve();
    await expect(controller.loadSession("session-2")).rejects.toThrow(
      "A Session lifecycle transition is already in progress",
    );
    pendingStart.resolve({
      kind: "session_ready",
      connection_epoch: 1,
      snapshot: snapshot(),
    });
    await firstLoad;

    expect(bridge.startedSessionIds).toEqual(["session-1"]);
    expect(controller.state.render.session?.summary.session_id).toBe("session-1");
  });

  it("blocks Session close after submit acceptance until authoritative Turn state arrives", async () => {
    const bridge = new FakeBridge();
    const controller = new DesktopController(bridge);
    await startLoaded(controller);

    await controller.submitTurn("accepted before event");

    await expect(controller.newChat()).rejects.toThrow(
      "Cannot change Session lifecycle while a Turn submission is pending",
    );
    await expect(controller.submitTurn("duplicate while pending")).rejects.toThrow(
      "A Turn submission is already pending",
    );
    expect(bridge.operations.filter((operation) => operation === "newChat")).toEqual([]);
    expect(bridge.submitCalls).toEqual([
      { sessionId: "session-1", text: "accepted before event" },
    ]);
  });

  it("closes the loaded runtime before binding submitTurn to another historical Session", async () => {
    const bridge = new FakeBridge();
    let startCount = 0;
    bridge.startSessionHandler = async (sessionId) => {
      startCount += 1;
      const loaded = snapshot();
      loaded.session.summary.session_id = sessionId;
      return {
        kind: "session_ready",
        connection_epoch: startCount,
        snapshot: loaded,
      };
    };
    const controller = new DesktopController(bridge);
    await controller.start();
    await controller.loadSession("session-1");

    await controller.loadSession("session-2");
    await controller.submitTurn("continue session two");

    expect(bridge.startedSessionIds).toEqual(["session-1", "session-2"]);
    expect(bridge.operations).toEqual([
      "listen:envelope",
      "listen:connection",
      "listSessions",
      "startSession",
      "listSessions",
      "newChat",
      "listSessions",
      "startSession",
      "listSessions",
      "submitTurn",
    ]);
    expect(controller.state.render.session?.summary.session_id).toBe("session-2");
    expect(controller.state.render.delivery.connectionEpoch).toBe(2);
    expect(bridge.submitCalls).toEqual([
      { sessionId: "session-2", text: "continue session two" },
    ]);
  });

  it("rejects submitTurn while a Session switch is in progress", async () => {
    const bridge = new FakeBridge();
    const pendingGeneration = deferred<DesktopResponse>();
    bridge.newChatHandler = async () => pendingGeneration.promise;
    bridge.startSessionHandler = async (sessionId) => {
      const loaded = snapshot();
      loaded.session.summary.session_id = sessionId;
      return {
        kind: "session_ready",
        connection_epoch:
          sessionId === "session-2" ? 2 : 1,
        snapshot: loaded,
      };
    };
    const controller = new DesktopController(bridge);
    await startLoaded(controller);

    const switching = controller.loadSession("session-2");
    await Promise.resolve();
    await expect(controller.submitTurn("must not reach the old Session")).rejects.toThrow(
      "Cannot submit a Turn during a Session lifecycle transition",
    );
    pendingGeneration.resolve({ kind: "generation_ready", connection_epoch: 2 });
    await switching;

    expect(bridge.submitCalls).toEqual([]);
    expect(controller.state.render.session?.summary.session_id).toBe("session-2");
  });

  it("retains the loaded Session when shutdown fails", async () => {
    const bridge = new FakeBridge();
    const controller = new DesktopController(bridge);
    await startLoaded(controller);
    let attempts = 0;
    bridge.newChatHandler = async () => {
      attempts += 1;
      return attempts === 1
        ? {
            kind: "rejected",
            error: { code: "shutdown_failed", message: "could not close session-1" },
          }
        : { kind: "generation_ready", connection_epoch: 2 };
    };

    await controller.newChat();

    expect(controller.state.connection).toEqual({
      kind: "degraded",
      message: "could not close session-1",
    });
    expect(controller.state.render.session?.summary.session_id).toBe("session-1");

    await controller.retryRuntime();

    expect(controller.state.connection).toEqual({ kind: "ready" });
    expect(controller.state.render.session).toBeNull();
    expect(controller.state.render.delivery.connectionEpoch).toBe(2);
  });

  it("clears the old Session and blocks submitTurn when fresh runtime creation fails", async () => {
    const bridge = new FakeBridge();
    const controller = new DesktopController(bridge);
    await startLoaded(controller);
    bridge.newChatHandler = async () => ({
      kind: "rejected",
      error: { code: "generation_not_ready", message: "fresh runtime unavailable" },
    });

    await controller.newChat();

    expect(controller.state.render.session).toBeNull();
    expect(controller.state.connection).toEqual({
      kind: "disconnected",
      message: "fresh runtime unavailable",
    });
    await expect(controller.submitTurn("must not be sent")).rejects.toThrow(
      "Desktop connection is not ready",
    );
  });

  it("reports catalog failure without treating it as an empty catalog", async () => {
    const bridge = new FakeBridge();
    bridge.listSessionsHandler = async () => ({
      kind: "rejected",
      error: { code: "catalog_unavailable", message: "session storage unavailable" },
    });
    const controller = new DesktopController(bridge);

    await controller.start();

    expect(controller.state.connection).toEqual({ kind: "ready" });
    expect(controller.state.catalog).toEqual({
      kind: "failed",
      rows: [],
      message: "session storage unavailable",
    });
  });

  it("ignores a catalog result from the generation replaced by New Chat", async () => {
    const bridge = new FakeBridge();
    const controller = new DesktopController(bridge);
    await startLoaded(controller);
    const staleCatalog = deferred<DesktopResponse>();
    let catalogCalls = 0;
    bridge.listSessionsHandler = async () => {
      catalogCalls += 1;
      return catalogCalls === 1
        ? staleCatalog.promise
        : { kind: "session_catalog_listed", connection_epoch: 2, rows: [] };
    };

    const staleRefresh = controller.retryCatalog();
    await Promise.resolve();
    await controller.newChat();
    staleCatalog.resolve({
      kind: "session_catalog_listed",
      connection_epoch: 1,
      rows: [
        {
          session_id: "session-1",
          first_user_message_excerpt: "stale",
          last_activity_at: null,
          loaded: true,
        },
      ],
    });
    await staleRefresh;

    expect(controller.state.render.delivery.connectionEpoch).toBe(2);
    expect(controller.state.render.session).toBeNull();
    expect(controller.state.catalog).toEqual({ kind: "empty", rows: [] });
  });

  it("keeps the page Blank and blocks submitTurn when history loading fails", async () => {
    const bridge = new FakeBridge();
    bridge.startSessionHandler = async () => ({
      kind: "rejected",
      error: { code: "session_start_failed", message: "session-1 is corrupt" },
    });
    const controller = new DesktopController(bridge);
    await controller.start();

    await controller.loadSession("session-1");

    expect(controller.state.render.session).toBeNull();
    expect(controller.state.connection).toEqual({
      kind: "disconnected",
      message: "session-1 is corrupt",
    });
    await expect(controller.submitTurn("must not be sent")).rejects.toThrow(
      "Desktop connection is not ready",
    );
  });
});

describe("DesktopController delivery orchestration", () => {
  it("subscribes before startSession and ignores boot events already included in SessionReady", async () => {
    const bridge = new FakeBridge();
    bridge.startSessionHandler = async () => {
      bridge.emitEnvelope(event(1, { kind: "turn_started", turn: 1 }));
      return { kind: "session_ready", connection_epoch: 1, snapshot: snapshot(1) };
    };
    const controller = new DesktopController(bridge);

    await startLoaded(controller);

    expect(bridge.operations).toEqual([
      "listen:envelope",
      "listen:connection",
      "listSessions",
      "startSession",
      "listSessions",
    ]);
    expect(controller.state.connection).toEqual({ kind: "ready" });
    expect(controller.state.render.run).toBe("idle");
    expect(controller.state.render.delivery.lastSeq).toBe(1);
  });

  it("buffers the triggering and subsequent events while a gap snapshot is pending", async () => {
    const bridge = new FakeBridge();
    const pendingSnapshot = deferred<DesktopResponse>();
    bridge.snapshotHandler = async () =>
      bridge.snapshotCalls.length === 1
        ? pendingSnapshot.promise
        : { kind: "snapshot", connection_epoch: 1, snapshot: snapshot(4) };
    const controller = new DesktopController(bridge);
    await startLoaded(controller);

    bridge.emitEnvelope(event(1, { kind: "turn_started", turn: 1 }));
    bridge.emitEnvelope(event(3, { kind: "turn_started", turn: 3 }));
    bridge.emitEnvelope(event(4, { kind: "turn_completed", turn: 3 }));
    pendingSnapshot.resolve({ kind: "snapshot", connection_epoch: 1, snapshot: snapshot(2) });
    await controller.whenSettled();

    expect(controller.state.connection).toEqual({ kind: "ready" });
    expect(controller.state.render.delivery.lastSeq).toBe(4);
    expect(controller.state.render.run).toBe("idle");
    expect(bridge.snapshotCalls).toHaveLength(2);
  });

  it("establishes a new-epoch baseline before replaying its triggering event", async () => {
    const bridge = new FakeBridge();
    bridge.snapshotHandler = async () => ({
      kind: "snapshot",
      connection_epoch: 2,
      snapshot: snapshot(),
    });
    const controller = new DesktopController(bridge);
    await startLoaded(controller);

    bridge.emitEnvelope(event(1, { kind: "turn_started", turn: 2 }, 2));
    await controller.whenSettled();

    expect(controller.state.connection).toEqual({ kind: "ready" });
    expect(controller.state.render.delivery.connectionEpoch).toBe(2);
    expect(controller.state.render.run).toEqual({ thinking: { turn: 2, step: 0 } });
  });

  it("uses one snapshot for orphan degradation and disconnects on resync failure", async () => {
    const bridge = new FakeBridge();
    bridge.snapshotHandler = async () => {
      throw new Error("snapshot unavailable");
    };
    const controller = new DesktopController(bridge);
    await startLoaded(controller);

    bridge.emitEnvelope(
      event(1, {
        kind: "tool_result",
        turn: 1,
        result: {
          tool_use_id: "missing",
          name: "grep",
          status: "succeeded",
          content: { text: "ok" },
        },
      }),
    );
    await controller.whenSettled();

    expect(controller.state.connection).toEqual({
      kind: "disconnected",
      message: "Desktop resync failed: snapshot unavailable",
    });
    expect(bridge.snapshotCalls).toHaveLength(1);
  });

  it("requests one baseline for an explicit resync marker", async () => {
    const bridge = new FakeBridge();
    bridge.snapshotHandler = async () => ({
      kind: "snapshot",
      connection_epoch: 1,
      snapshot: snapshot(1),
    });
    const controller = new DesktopController(bridge);
    await startLoaded(controller);

    bridge.emitEnvelope(event(1, { kind: "resync_required", reason: "explicit_request" }));
    await controller.whenSettled();

    expect(controller.state.connection).toEqual({ kind: "ready" });
    expect(controller.state.render.delivery.lastSeq).toBe(1);
    expect(bridge.snapshotCalls).toHaveLength(1);
  });

  it("refreshes the authoritative Session Item Log at turn completion and replays buffered events", async () => {
    const bridge = new FakeBridge();
    const pendingSnapshot = deferred<DesktopResponse>();
    bridge.submitTurnHandler = async () => ({ kind: "turn_accepted", turn: 0 });
    bridge.snapshotHandler = async () => pendingSnapshot.promise;
    const controller = new DesktopController(bridge);
    await startLoaded(controller);

    await controller.submitTurn("hello");
    bridge.emitEnvelope(event(1, { kind: "turn_completed", turn: 0 }));
    bridge.emitEnvelope(event(2, { kind: "state_changed", state: "idle" }));
    pendingSnapshot.resolve({
      kind: "snapshot",
      connection_epoch: 1,
      snapshot: completedSnapshot(2, "hello"),
    });
    await controller.whenSettled();

    expect(controller.state.connection).toEqual({ kind: "ready" });
    expect(controller.state.render.messages).toEqual([
      { kind: "user", turn: 0, text: "hello" },
    ]);
    expect(controller.state.render.delivery.lastSeq).toBe(2);
    expect(bridge.snapshotCalls).toHaveLength(1);
  });

  it("takes a follow-up terminal snapshot when completion races an existing resync", async () => {
    const bridge = new FakeBridge();
    const firstSnapshot = deferred<DesktopResponse>();
    bridge.snapshotHandler = async () =>
      bridge.snapshotCalls.length === 1
        ? firstSnapshot.promise
        : {
            kind: "snapshot",
            connection_epoch: 1,
            snapshot: completedSnapshot(3, "raced message"),
          };
    const controller = new DesktopController(bridge);
    await startLoaded(controller);

    bridge.emitEnvelope(event(2, { kind: "turn_started", turn: 0 }));
    bridge.emitEnvelope(event(3, { kind: "turn_completed", turn: 0 }));
    firstSnapshot.resolve({ kind: "snapshot", connection_epoch: 1, snapshot: snapshot(2) });
    await controller.whenSettled();

    expect(controller.state.connection).toEqual({ kind: "ready" });
    expect(controller.state.render.messages).toEqual([
      { kind: "user", turn: 0, text: "raced message" },
    ]);
    expect(bridge.snapshotCalls).toHaveLength(2);
  });

  it("disconnects when the terminal authoritative snapshot cannot be loaded", async () => {
    const bridge = new FakeBridge();
    bridge.snapshotHandler = async () => {
      throw new Error("session unavailable");
    };
    const controller = new DesktopController(bridge);
    await startLoaded(controller);

    bridge.emitEnvelope(
      event(1, {
        kind: "turn_failed",
        turn: 0,
        error: { kind: "provider", message: "provider failed", recoverable: true },
      }),
    );
    await controller.whenSettled();

    expect(controller.state.connection).toEqual({
      kind: "disconnected",
      message: "Desktop terminal refresh failed: session unavailable",
    });
    expect(bridge.snapshotCalls).toHaveLength(1);
  });

  it("disconnects instead of retrying when a baseline cannot close the same gap", async () => {
    const bridge = new FakeBridge();
    const controller = new DesktopController(bridge);
    await startLoaded(controller);

    bridge.emitEnvelope(event(2, { kind: "turn_started", turn: 2 }));
    await controller.whenSettled();

    expect(controller.state.connection).toEqual({
      kind: "disconnected",
      message: "Desktop resync baseline did not close the delivery gap",
    });
    expect(bridge.snapshotCalls).toHaveLength(1);
  });

  it("bounds event buffering and records connection closure", async () => {
    const bridge = new FakeBridge();
    const pendingSnapshot = deferred<DesktopResponse>();
    bridge.snapshotHandler = async () => pendingSnapshot.promise;
    const controller = new DesktopController(bridge, 2);
    await startLoaded(controller);

    bridge.emitEnvelope(event(2, { kind: "turn_started", turn: 2 }));
    bridge.emitEnvelope(event(3, { kind: "turn_started", turn: 3 }));
    bridge.emitEnvelope(event(4, { kind: "turn_started", turn: 4 }));

    expect(controller.state.connection).toEqual({
      kind: "disconnected",
      message: "Desktop event buffer overflowed while awaiting snapshot",
    });
    pendingSnapshot.resolve({ kind: "snapshot", connection_epoch: 1, snapshot: snapshot(4) });
    await controller.whenSettled();
  });

  it("preserves degraded close evidence and observable disconnection", async () => {
    const bridge = new FakeBridge();
    const controller = new DesktopController(bridge);
    await startLoaded(controller);

    bridge.emitConnection({ kind: "degraded_shutdown", message: "closing" });
    expect(controller.state.connection).toEqual({ kind: "degraded", message: "closing" });
    bridge.emitConnection({ kind: "disconnected", message: "transport closed" });
    expect(controller.state.connection).toEqual({
      kind: "disconnected",
      message: "transport closed",
    });
  });

  it("returns typed rejection as a domain response without disconnecting", async () => {
    const bridge = new FakeBridge();
    const controller = new DesktopController(bridge);
    await startLoaded(controller);
    bridge.submitTurnHandler = async () => ({
      kind: "rejected",
      error: { code: "busy", message: "desktop host is busy" },
    });

    const result = await controller.submitTurn("hello");

    expect(result).toEqual({
      kind: "rejected",
      error: { code: "busy", message: "desktop host is busy" },
    });
    expect(controller.state.connection).toEqual({ kind: "ready" });
    expect(controller.state.render.notices.at(-1)?.message).toBe("desktop host is busy");
  });

  it("disconnects when the bridge returns an invalid protocol value", async () => {
    const bridge = new FakeBridge();
    const controller = new DesktopController(bridge);
    await startLoaded(controller);
    bridge.submitTurnHandler = async () =>
      ({ invalid: true }) as unknown as DesktopResponse;

    await expect(controller.submitTurn("hello")).rejects.toThrow();
    expect(controller.state.connection.kind).toBe("disconnected");
  });
});
