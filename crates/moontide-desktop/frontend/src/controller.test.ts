import { describe, expect, it } from "vitest";

import { DesktopController, type DesktopBridge, type Unlisten } from "./controller";
import {
  parseDesktopMessageEnvelope,
  type DesktopCommand,
  type DesktopProtocolEvent,
  type DesktopResponse,
  type DesktopSnapshot,
} from "./protocol";

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

function response(payload: DesktopResponse, epoch = 1): unknown {
  return {
    protocol_version: 1,
    connection_epoch: epoch,
    request_id: `request-${payload.kind}`,
    seq: null,
    payload: { kind: "response", response: payload },
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
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class FakeBridge implements DesktopBridge {
  readonly operations: string[] = [];
  readonly commands: DesktopCommand[] = [];
  requestHandler: (command: DesktopCommand) => Promise<unknown> = async (command) => {
    switch (command.kind) {
      case "handshake":
        return response({ kind: "handshake_accepted", protocol_version: 1 });
      case "start_session":
        return response({ kind: "session_ready", snapshot: snapshot() });
      case "snapshot":
        return response({ kind: "snapshot", snapshot: snapshot() });
      default:
        throw new Error(`unexpected command ${command.kind}`);
    }
  };
  #envelopeListener: ((payload: unknown) => void) | null = null;
  #connectionListener: ((payload: unknown) => void) | null = null;

  async request(command: DesktopCommand): Promise<unknown> {
    this.operations.push(`request:${command.kind}`);
    this.commands.push(command);
    return this.requestHandler(command);
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

describe("DesktopController delivery orchestration", () => {
  it("subscribes before handshake and ignores boot events already included in SessionReady", async () => {
    const bridge = new FakeBridge();
    bridge.requestHandler = async (command) => {
      if (command.kind === "handshake") {
        return response({ kind: "handshake_accepted", protocol_version: 1 });
      }
      if (command.kind === "start_session") {
        bridge.emitEnvelope(event(1, { kind: "turn_started", turn: 1 }));
        return response({ kind: "session_ready", snapshot: snapshot(1) });
      }
      throw new Error(`unexpected command ${command.kind}`);
    };
    const controller = new DesktopController(bridge);

    await controller.start();

    expect(bridge.operations).toEqual([
      "listen:envelope",
      "listen:connection",
      "request:handshake",
      "request:start_session",
    ]);
    expect(controller.state.connection).toEqual({ kind: "ready" });
    expect(controller.state.render.run).toBe("idle");
    expect(controller.state.render.delivery.lastSeq).toBe(1);
  });

  it("buffers the triggering and subsequent events while a gap snapshot is pending", async () => {
    const bridge = new FakeBridge();
    const pendingSnapshot = deferred<unknown>();
    bridge.requestHandler = async (command) => {
      if (command.kind === "handshake") {
        return response({ kind: "handshake_accepted", protocol_version: 1 });
      }
      if (command.kind === "start_session") {
        return response({ kind: "session_ready", snapshot: snapshot() });
      }
      if (command.kind === "snapshot") {
        return pendingSnapshot.promise;
      }
      throw new Error(`unexpected command ${command.kind}`);
    };
    const controller = new DesktopController(bridge);
    await controller.start();

    bridge.emitEnvelope(event(1, { kind: "turn_started", turn: 1 }));
    bridge.emitEnvelope(event(3, { kind: "turn_started", turn: 3 }));
    bridge.emitEnvelope(event(4, { kind: "turn_completed", turn: 3 }));
    pendingSnapshot.resolve(response({ kind: "snapshot", snapshot: snapshot(2) }));
    await controller.whenSettled();

    expect(controller.state.connection).toEqual({ kind: "ready" });
    expect(controller.state.render.delivery.lastSeq).toBe(4);
    expect(controller.state.render.run).toBe("idle");
    expect(bridge.commands.filter((command) => command.kind === "snapshot")).toHaveLength(1);
  });

  it("establishes a new-epoch baseline before replaying its triggering event", async () => {
    const bridge = new FakeBridge();
    bridge.requestHandler = async (command) => {
      if (command.kind === "handshake") {
        return response({ kind: "handshake_accepted", protocol_version: 1 });
      }
      if (command.kind === "start_session") {
        return response({ kind: "session_ready", snapshot: snapshot() });
      }
      if (command.kind === "snapshot") {
        return response({ kind: "snapshot", snapshot: snapshot() }, 2);
      }
      throw new Error(`unexpected command ${command.kind}`);
    };
    const controller = new DesktopController(bridge);
    await controller.start();

    bridge.emitEnvelope(event(1, { kind: "turn_started", turn: 2 }, 2));
    await controller.whenSettled();

    expect(controller.state.connection).toEqual({ kind: "ready" });
    expect(controller.state.render.delivery.connectionEpoch).toBe(2);
    expect(controller.state.render.run).toEqual({ thinking: { turn: 2, step: 0 } });
  });

  it("uses one snapshot for orphan degradation and disconnects on resync failure", async () => {
    const bridge = new FakeBridge();
    bridge.requestHandler = async (command) => {
      if (command.kind === "handshake") {
        return response({ kind: "handshake_accepted", protocol_version: 1 });
      }
      if (command.kind === "start_session") {
        return response({ kind: "session_ready", snapshot: snapshot() });
      }
      if (command.kind === "snapshot") {
        throw new Error("snapshot unavailable");
      }
      throw new Error(`unexpected command ${command.kind}`);
    };
    const controller = new DesktopController(bridge);
    await controller.start();

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
    expect(bridge.commands.filter((command) => command.kind === "snapshot")).toHaveLength(1);
  });

  it("requests one baseline for an explicit resync marker", async () => {
    const bridge = new FakeBridge();
    bridge.requestHandler = async (command) => {
      if (command.kind === "handshake") {
        return response({ kind: "handshake_accepted", protocol_version: 1 });
      }
      if (command.kind === "start_session") {
        return response({ kind: "session_ready", snapshot: snapshot() });
      }
      if (command.kind === "snapshot") {
        return response({ kind: "snapshot", snapshot: snapshot(1) });
      }
      throw new Error(`unexpected command ${command.kind}`);
    };
    const controller = new DesktopController(bridge);
    await controller.start();

    bridge.emitEnvelope(event(1, { kind: "resync_required", reason: "explicit_request" }));
    await controller.whenSettled();

    expect(controller.state.connection).toEqual({ kind: "ready" });
    expect(controller.state.render.delivery.lastSeq).toBe(1);
    expect(bridge.commands.filter((command) => command.kind === "snapshot")).toHaveLength(1);
  });

  it("disconnects instead of retrying when a baseline cannot close the same gap", async () => {
    const bridge = new FakeBridge();
    const controller = new DesktopController(bridge);
    await controller.start();

    bridge.emitEnvelope(event(2, { kind: "turn_started", turn: 2 }));
    await controller.whenSettled();

    expect(controller.state.connection).toEqual({
      kind: "disconnected",
      message: "Desktop resync baseline did not close the delivery gap",
    });
    expect(bridge.commands.filter((command) => command.kind === "snapshot")).toHaveLength(1);
  });

  it("bounds event buffering and records connection closure", async () => {
    const bridge = new FakeBridge();
    const pendingSnapshot = deferred<unknown>();
    bridge.requestHandler = async (command) => {
      if (command.kind === "handshake") {
        return response({ kind: "handshake_accepted", protocol_version: 1 });
      }
      if (command.kind === "start_session") {
        return response({ kind: "session_ready", snapshot: snapshot() });
      }
      if (command.kind === "snapshot") {
        return pendingSnapshot.promise;
      }
      throw new Error(`unexpected command ${command.kind}`);
    };
    const controller = new DesktopController(bridge, 2);
    await controller.start();

    bridge.emitEnvelope(event(2, { kind: "turn_started", turn: 2 }));
    bridge.emitEnvelope(event(3, { kind: "turn_started", turn: 3 }));
    bridge.emitEnvelope(event(4, { kind: "turn_started", turn: 4 }));

    expect(controller.state.connection).toEqual({
      kind: "disconnected",
      message: "Desktop event buffer overflowed while awaiting snapshot",
    });
    pendingSnapshot.resolve(response({ kind: "snapshot", snapshot: snapshot(4) }));
    await controller.whenSettled();
  });

  it("preserves degraded close evidence and observable disconnection", async () => {
    const bridge = new FakeBridge();
    const controller = new DesktopController(bridge);
    await controller.start();

    bridge.emitConnection({ kind: "degraded_shutdown", message: "closing" });
    expect(controller.state.connection).toEqual({ kind: "degraded", message: "closing" });
    bridge.emitConnection({ kind: "disconnected", message: "transport closed" });
    expect(controller.state.connection).toEqual({
      kind: "disconnected",
      message: "transport closed",
    });
  });

  it("keeps typed rejection as a domain response without disconnecting", async () => {
    const bridge = new FakeBridge();
    const controller = new DesktopController(bridge);
    await controller.start();
    bridge.requestHandler = async (command) => {
      expect(command.kind).toBe("submit_turn");
      return response({
        kind: "rejected",
        error: { code: "busy", message: "desktop host is busy" },
      });
    };

    const result = await controller.send({ kind: "submit_turn", text: "hello" });

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
    await controller.start();
    bridge.requestHandler = async () => ({ invalid: true });

    await expect(controller.send({ kind: "cancel_turn" })).rejects.toThrow();
    expect(controller.state.connection.kind).toBe("disconnected");
  });
});
