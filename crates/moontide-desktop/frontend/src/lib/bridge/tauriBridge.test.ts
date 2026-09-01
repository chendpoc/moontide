import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));

import { createTauriBridge } from "$lib/bridge/tauriBridge.js";

describe("Tauri Desktop bridge", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
  });

  it("exposes typed invoke commands and two receive-only event channels", async () => {
    invokeMock.mockResolvedValue({ kind: "turn_accepted", turn: 0 });
    const listeners = new Map<string, (event: { payload: unknown }) => void>();
    const unlisten = vi.fn();
    listenMock.mockImplementation(
      async (eventName: string, listener: (event: { payload: unknown }) => void) => {
        listeners.set(eventName, listener);
        return unlisten;
      },
    );
    const bridge = createTauriBridge();
    const envelopes: unknown[] = [];
    const connections: unknown[] = [];

    await bridge.listSessions();
    await bridge.newChat();
    await bridge.createSession();
    await bridge.startSession("session-1");
    await bridge.loadSessionHistory("session-1", 30, 30);
    await bridge.submitTurn("session-1", "continue");
    await bridge.cancelTurn();
    const removeEnvelope = await bridge.listenEnvelope((payload) => envelopes.push(payload));
    const removeConnection = await bridge.listenConnection((payload) => connections.push(payload));
    listeners.get("desktop-envelope")?.({ payload: { kind: "envelope" } });
    listeners.get("desktop-connection")?.({ payload: { kind: "closed" } });
    await removeEnvelope();
    await removeConnection();

    expect(invokeMock).toHaveBeenCalledWith("list_sessions");
    expect(invokeMock).toHaveBeenCalledWith("new_chat");
    expect(invokeMock).toHaveBeenCalledWith("create_session");
    expect(invokeMock).toHaveBeenCalledWith("start_session", {
      sessionId: "session-1",
    });
    expect(invokeMock).toHaveBeenCalledWith("load_session_history", {
      sessionId: "session-1",
      beforeTurn: 30,
      limit: 30,
    });
    expect(invokeMock).toHaveBeenCalledWith("submit_turn", {
      sessionId: "session-1",
      text: "continue",
    });
    expect(invokeMock).toHaveBeenCalledWith("cancel_turn");
    expect([...listeners.keys()]).toEqual(["desktop-envelope", "desktop-connection"]);
    expect(envelopes).toEqual([{ kind: "envelope" }]);
    expect(connections).toEqual([{ kind: "closed" }]);
    expect(unlisten).toHaveBeenCalledTimes(2);
  });
});
