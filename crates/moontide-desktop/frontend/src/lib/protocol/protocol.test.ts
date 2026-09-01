import { describe, expect, it } from "vitest";

import eventFixtures from "../../../../src-tauri/tests/protocol/fixtures/events.json";

import {
  DesktopCommandSchema,
  DesktopMessageEnvelopeSchema,
  parseDesktopMessageEnvelope,
  parseDesktopResponse,
} from "$lib/protocol/index.js";

describe("desktop protocol v1 fixtures", () => {
  it("parses every frozen event variant and preserves delivery identity", () => {
    const events = DesktopMessageEnvelopeSchema.array().parse(eventFixtures);

    expect(events).toEqual(eventFixtures);
    expect(events).toHaveLength(14);

    const eventEpochs = events
      .map((envelope) => envelope.connection_epoch)
      .filter((epoch): epoch is number => epoch !== null);
    const eventSeqs = events
      .map((envelope) => envelope.seq)
      .filter((seq): seq is number => seq !== null);
    expect(new Set(eventEpochs).size).toBe(1);
    expect(eventEpochs).toHaveLength(events.length);
    expect(eventSeqs).toHaveLength(events.length);
    for (let index = 1; index < eventSeqs.length; index += 1) {
      expect(eventSeqs[index]).toBeGreaterThan(eventSeqs[index - 1] ?? -1);
    }

    expect(
      new Set(
        events.map((envelope) =>
          envelope.payload.kind === "event" ? envelope.payload.event.kind : "invalid",
        ),
      ),
    ).toEqual(
      new Set([
        "turn_started",
        "llm_call_started",
        "assistant_response_snapshot",
        "tool_call",
        "tool_result",
        "llm_call_ended",
        "assistant_finalized",
        "turn_ended",
        "state_changed",
        "approval_requested",
        "turn_completed",
        "turn_failed",
        "resync_required",
        "stopped",
      ]),
    );
  });

  it("rejects identity combinations that would merge correlation and delivery order", () => {
    const event: unknown = { ...structuredClone(eventFixtures[0]), request_id: "forged-request" };
    expect(() => parseDesktopMessageEnvelope(event)).toThrow(/event requires/);

    const command: unknown = {
      protocol_version: 1,
      connection_epoch: 1,
      request_id: "req-1",
      seq: 1,
      payload: {
        kind: "command",
        command: { kind: "submit_turn", session_id: "session-1", text: "hello" },
      },
    };
    expect(() => parseDesktopMessageEnvelope(command)).toThrow(/command requires/);

    const response: unknown = {
      protocol_version: 1,
      connection_epoch: null,
      request_id: "req-1",
      seq: null,
      payload: { kind: "response", response: { kind: "turn_accepted", turn: 0 } },
    };
    expect(() => parseDesktopMessageEnvelope(response)).toThrow(/response requires/);
  });

  it("preserves externally tagged nested Rust enum payloads", () => {
    const cancelled = parseDesktopMessageEnvelope({
      protocol_version: 1,
      connection_epoch: 1,
      request_id: null,
      seq: 1,
      payload: {
        kind: "event",
        event: {
          kind: "tool_result",
          turn: 1,
          result: {
            tool_use_id: "tool-1",
            name: "read",
            status: { cancelled: { reason: "parent" } },
            content: { text: "cancelled" },
          },
        },
      },
    });

    expect(cancelled.payload).toEqual({
      kind: "event",
      event: {
        kind: "tool_result",
        turn: 1,
        result: {
          tool_use_id: "tool-1",
          name: "read",
          status: { cancelled: { reason: "parent" } },
          content: { text: "cancelled" },
        },
      },
    });
  });

  it("parses session lifecycle invoke responses", () => {
    expect(
      parseDesktopResponse({
        kind: "session_catalog_listed",
        connection_epoch: 4,
        rows: [
          {
            session_id: "session-1",
            first_user_message_excerpt: "hello",
            last_activity_at: "2026-09-01T08:00:00Z",
            loaded: true,
          },
        ],
      }),
    ).toMatchObject({ kind: "session_catalog_listed" });

    expect(parseDesktopResponse({ kind: "generation_ready", connection_epoch: 4 })).toEqual({
      kind: "generation_ready",
      connection_epoch: 4,
    });

    expect(() =>
      parseDesktopResponse({
        kind: "session_catalog_listed",
        connection_epoch: 4,
        rows: [
          {
            session_id: "session-1",
            first_user_message_excerpt: null,
            last_activity_at: null,
            loaded: true,
          },
          {
            session_id: "session-2",
            first_user_message_excerpt: null,
            last_activity_at: null,
            loaded: true,
          },
        ],
      }),
    ).toThrow("Session catalog must not contain more than one loaded Session");
  });

  it("keeps Session creation distinct from loading an existing identity", () => {
    expect(DesktopCommandSchema.parse({ kind: "create_session" })).toEqual({
      kind: "create_session",
    });
    expect(
      DesktopCommandSchema.parse({ kind: "start_session", session_id: "session-1" }),
    ).toEqual({ kind: "start_session", session_id: "session-1" });
    expect(() =>
      DesktopCommandSchema.parse({
        kind: "start_session",
        selection: { kind: "new" },
      }),
    ).toThrow();
  });
});
