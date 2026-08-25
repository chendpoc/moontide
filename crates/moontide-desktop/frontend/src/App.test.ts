// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";

import App from "./App.svelte";
import {
  DesktopController,
  type DesktopBridge,
  type DesktopControllerPort,
  type DesktopViewState,
  type Unlisten,
} from "./controller";
import type {
  DesktopCommand,
  DesktopProtocolEvent,
  DesktopResponse,
  DesktopSnapshot,
} from "./protocol";
import { createRenderState } from "./renderState";

class FakeController implements DesktopControllerPort {
  state: DesktopViewState;
  readonly commands: DesktopCommand[] = [];
  starts = 0;
  disposals = 0;
  readonly #subscribers = new Set<(state: DesktopViewState) => void>();

  constructor(state = readyView()) {
    this.state = state;
  }

  subscribe(subscriber: (state: DesktopViewState) => void): () => void {
    this.#subscribers.add(subscriber);
    subscriber(this.state);
    return () => this.#subscribers.delete(subscriber);
  }

  async start(): Promise<void> {
    this.starts += 1;
  }

  async send(command: DesktopCommand): Promise<DesktopResponse> {
    this.commands.push(command);
    switch (command.kind) {
      case "submit_turn":
        return { kind: "turn_accepted", turn: 1 };
      case "cancel_turn":
        return { kind: "cancellation_accepted", turn: 1 };
      case "approve":
      case "deny":
        return { kind: "approval_accepted", approval_id: command.approval_id };
      default:
        return {
          kind: "rejected",
          error: { code: "invalid_input", message: "unsupported fake command" },
        };
    }
  }

  async dispose(): Promise<void> {
    this.disposals += 1;
  }
}

class IntegrationBridge implements DesktopBridge {
  #envelopeListener: ((payload: unknown) => void) | null = null;

  async request(command: DesktopCommand): Promise<unknown> {
    switch (command.kind) {
      case "handshake":
        return wireResponse({ kind: "handshake_accepted", protocol_version: 1 });
      case "start_session":
        return wireResponse({ kind: "session_ready", snapshot: protocolSnapshot() });
      case "submit_turn":
        return wireResponse({ kind: "turn_accepted", turn: 0 });
      case "snapshot":
        return wireResponse({
          kind: "snapshot",
          snapshot: protocolSnapshot(1, "hello MoonTide"),
        });
      default:
        throw new Error(`unexpected integration command ${command.kind}`);
    }
  }

  async listenEnvelope(listener: (payload: unknown) => void): Promise<Unlisten> {
    this.#envelopeListener = listener;
    return () => {
      this.#envelopeListener = null;
    };
  }

  async listenConnection(): Promise<Unlisten> {
    return () => undefined;
  }

  completeTurn(): void {
    this.#envelopeListener?.(
      wireEvent(1, { kind: "turn_completed", turn: 0 }),
    );
  }
}

describe("App", () => {
  it("renders protocol content as escaped text from RenderState", async () => {
    const state = readyView();
    state.render.messages = [
      { kind: "user", turn: 1, text: '<img src=x onerror="alert(1)">' },
      {
        kind: "assistant",
        turn: 1,
        blocks: [
          { kind: "thinking", thinking: "private chain" },
          { kind: "text", text: "visible answer" },
        ],
      },
    ];
    state.render.assistantDrafts["2:call-2"] = {
      turn: 2,
      step: 0,
      llmCallId: "call-2",
      updateIndex: 1,
      snapshot: {
        content: [{ kind: "text", text: "streaming answer" }],
        pending: { kind: "text", text: "…" },
        stop_reason: null,
        usage: null,
        model: null,
      },
    };
    state.render.notices.push({
      kind: "error",
      message: "provider unavailable",
      recoverable: true,
      errorKind: "provider",
    });

    const controller = new FakeController(state);
    render(App, { props: { controller } });

    expect(await screen.findByText('<img src=x onerror="alert(1)">')).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText("visible answer")).toBeInTheDocument();
    expect(screen.queryByText("private chain")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === "P" && element.textContent === "streaming answer\n…",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("provider unavailable")).toBeInTheDocument();
  });

  it("boots through the injected controller and submits only typed intent", async () => {
    const controller = new FakeController();
    const rendered = render(App, { props: { controller } });

    const input = screen.getByRole("textbox", { name: "Message" });
    await fireEvent.input(input, { target: { value: "  hello MoonTide  " } });
    await fireEvent.keyDown(input, { key: "Enter", metaKey: true });

    await waitFor(() => {
      expect(controller.commands).toEqual([{ kind: "submit_turn", text: "hello MoonTide" }]);
    });
    expect(input).toHaveValue("");
    expect(controller.starts).toBe(1);

    rendered.unmount();
    await waitFor(() => expect(controller.disposals).toBe(1));
  });

  it("renders a submitted user message from the terminal authoritative snapshot", async () => {
    const bridge = new IntegrationBridge();
    const controller = new DesktopController(bridge);
    render(App, { props: { controller } });

    const input = screen.getByRole("textbox", { name: "Message" });
    await waitFor(() => expect(input).toBeEnabled());
    await fireEvent.input(input, { target: { value: "hello MoonTide" } });
    await fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(input).toHaveValue(""));

    bridge.completeTurn();

    expect(await screen.findByText("hello MoonTide")).toBeInTheDocument();
    expect(screen.queryByText("Start a conversation with MoonTide.")).not.toBeInTheDocument();
  });

  it("maps active-turn and approval controls to controller intents", async () => {
    const active = readyView();
    active.render.run = { thinking: { turn: 1, step: 0 } };
    const activeController = new FakeController(active);
    const activeView = render(App, { props: { controller: activeController } });

    await fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() =>
      expect(activeController.commands).toEqual([{ kind: "cancel_turn" }]),
    );
    activeView.unmount();

    const approval = readyView();
    approval.render.run = {
      waiting_approval: { turn: 1, request_id: "approval-1" },
    };
    approval.render.approvals["approval-1"] = {
      request: {
        id: "approval-1",
        turn: 1,
        call: { tool_use_id: "tool-1", name: "bash", input: { cmd: "pwd" } },
        working_dir: "/workspace",
      },
    };
    const approvalController = new FakeController(approval);
    render(App, { props: { controller: approvalController } });

    await fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    await fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    await waitFor(() =>
      expect(approvalController.commands).toEqual([
        { kind: "approve", approval_id: "approval-1" },
        {
          kind: "deny",
          approval_id: "approval-1",
          reason: "denied from desktop ui",
        },
      ]),
    );
  });

  it("makes transport disconnection and resync evidence visible and disables intent", async () => {
    const state = readyView();
    state.connection = { kind: "disconnected", message: "event stream closed" };
    state.render.notices.push({
      kind: "resync",
      message: "desktop state requires resync: event_gap",
      recoverable: true,
      errorKind: null,
    });

    render(App, { props: { controller: new FakeController(state) } });

    expect(await screen.findByText("Disconnected")).toBeInTheDocument();
    expect(screen.getByText("event stream closed")).toBeInTheDocument();
    expect(screen.getByText("desktop state requires resync: event_gap")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Message" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Stop" })).toBeDisabled();
  });
});

function readyView(): DesktopViewState {
  const render = createRenderState();
  render.run = "idle";
  render.session = {
    summary: {
      session_id: "session-1",
      cwd: "/workspace",
      last_turn: null,
      item_count: 0,
    },
    items: [],
  };
  return { connection: { kind: "ready" }, render };
}

function protocolSnapshot(lastSeq = 0, userText?: string): DesktopSnapshot {
  const items =
    userText === undefined
      ? []
      : [
          {
            kind: "user_message" as const,
            base: {
              id: "item-1",
              seq: 0,
              session_id: "session-1",
              turn: 0,
              at: "2026-08-25T00:00:00Z",
            },
            text: userText,
          },
        ];
  return {
    session: {
      summary: {
        session_id: "session-1",
        cwd: "/workspace",
        last_turn: userText === undefined ? null : 0,
        item_count: items.length,
      },
      items,
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

function wireResponse(response: DesktopResponse): unknown {
  return {
    protocol_version: 1,
    connection_epoch: 1,
    request_id: `request-${response.kind}`,
    seq: null,
    payload: { kind: "response", response },
  };
}

function wireEvent(seq: number, event: DesktopProtocolEvent): unknown {
  return {
    protocol_version: 1,
    connection_epoch: 1,
    request_id: null,
    seq,
    payload: { kind: "event", event },
  };
}
