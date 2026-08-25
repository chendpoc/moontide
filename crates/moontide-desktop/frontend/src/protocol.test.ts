import { describe, expect, it } from "vitest";

import commandFixtures from "../../../desktop-protocol/tests/fixtures/commands.json";
import eventFixtures from "../../../desktop-protocol/tests/fixtures/events.json";
import responseFixtures from "../../../desktop-protocol/tests/fixtures/responses.json";

import { DesktopMessageEnvelopeSchema, parseDesktopMessageEnvelope } from "./protocol";

describe("desktop protocol v1 fixtures", () => {
  it("parses every frozen top-level command, response, and event variant", () => {
    const commands = DesktopMessageEnvelopeSchema.array().parse(commandFixtures);
    const responses = DesktopMessageEnvelopeSchema.array().parse(responseFixtures);
    const events = DesktopMessageEnvelopeSchema.array().parse(eventFixtures);

    expect(commands).toEqual(commandFixtures);
    expect(responses).toEqual(responseFixtures);
    expect(events).toEqual(eventFixtures);
    expect(commands).toHaveLength(8);
    expect(responses).toHaveLength(8);
    expect(events).toHaveLength(14);

    const commandRequestIds = commands
      .map((envelope) => envelope.request_id)
      .filter((requestId): requestId is string => requestId !== null);
    const responseRequestIds = responses
      .map((envelope) => envelope.request_id)
      .filter((requestId): requestId is string => requestId !== null);
    expect(new Set(commandRequestIds).size).toBe(commands.length);
    expect(new Set(responseRequestIds).size).toBe(responses.length);
    expect(new Set(responseRequestIds)).toEqual(new Set(commandRequestIds));

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
        commands.map((envelope) =>
          envelope.payload.kind === "command" ? envelope.payload.command.kind : "invalid",
        ),
      ),
    ).toEqual(
      new Set([
        "handshake",
        "start_session",
        "submit_turn",
        "cancel_turn",
        "approve",
        "deny",
        "snapshot",
        "shutdown",
      ]),
    );
    expect(
      new Set(
        responses.map((envelope) =>
          envelope.payload.kind === "response" ? envelope.payload.response.kind : "invalid",
        ),
      ),
    ).toEqual(
      new Set([
        "handshake_accepted",
        "session_ready",
        "turn_accepted",
        "cancellation_accepted",
        "approval_accepted",
        "snapshot",
        "shutdown_completed",
        "rejected",
      ]),
    );
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

    const command: unknown = { ...structuredClone(commandFixtures[1]), seq: 1 };
    expect(() => parseDesktopMessageEnvelope(command)).toThrow(/command requires/);

    const response: unknown = {
      ...structuredClone(responseFixtures[0]),
      connection_epoch: null,
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
});
