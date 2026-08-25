import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));

import { createTauriBridge } from "./tauriBridge";

describe("Tauri Desktop bridge", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
  });

  it("exposes one command and two receive-only event channels", async () => {
    invokeMock.mockResolvedValue({ payload: { kind: "response" } });
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

    await bridge.request({ kind: "cancel_turn" });
    const removeEnvelope = await bridge.listenEnvelope((payload) => envelopes.push(payload));
    const removeConnection = await bridge.listenConnection((payload) => connections.push(payload));
    listeners.get("desktop-envelope")?.({ payload: { kind: "envelope" } });
    listeners.get("desktop-connection")?.({ payload: { kind: "closed" } });
    await removeEnvelope();
    await removeConnection();

    expect(invokeMock).toHaveBeenCalledWith("desktop_request", {
      command: { kind: "cancel_turn" },
    });
    expect([...listeners.keys()]).toEqual(["desktop-envelope", "desktop-connection"]);
    expect(envelopes).toEqual([{ kind: "envelope" }]);
    expect(connections).toEqual([{ kind: "closed" }]);
    expect(unlisten).toHaveBeenCalledTimes(2);
  });
});
