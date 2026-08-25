import { z } from "zod";

export const DESKTOP_PROTOCOL_VERSION = 1 as const;

const uint = z.number().int().nonnegative();
const jsonValue = z.json();

export const DesktopCommandSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("handshake") }),
  z.strictObject({
    kind: z.literal("start_session"),
    selection: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("new") }),
      z.strictObject({ kind: z.literal("existing"), session_id: z.string() }),
    ]),
  }),
  z.strictObject({ kind: z.literal("submit_turn"), text: z.string() }),
  z.strictObject({ kind: z.literal("cancel_turn") }),
  z.strictObject({ kind: z.literal("approve"), approval_id: z.string() }),
  z.strictObject({
    kind: z.literal("deny"),
    approval_id: z.string(),
    reason: z.string(),
  }),
  z.strictObject({ kind: z.literal("snapshot") }),
  z.strictObject({ kind: z.literal("shutdown") }),
]);

const DesktopCommandErrorSchema = z.strictObject({
  code: z.enum([
    "protocol_version_unsupported",
    "handshake_required",
    "session_not_started",
    "session_already_started",
    "busy",
    "no_active_turn",
    "approval_not_found",
    "approval_already_resolved",
    "stopping",
    "stopped",
    "event_stream_closed",
    "invalid_input",
    "internal",
  ]),
  message: z.string(),
});

const DesktopErrorSchema = z.strictObject({
  kind: z.enum([
    "configuration",
    "provider",
    "tool",
    "approval",
    "cancelled",
    "persistence",
    "internal",
  ]),
  message: z.string(),
  recoverable: z.boolean(),
});

const DesktopRunStateSchema = z.union([
  z.enum(["starting", "idle", "stopping", "stopped"]),
  z.strictObject({
    thinking: z.strictObject({ turn: uint, step: uint }),
  }),
  z.strictObject({
    running_tool: z.strictObject({
      turn: uint,
      tool_use_id: z.string(),
      name: z.string(),
    }),
  }),
  z.strictObject({
    waiting_approval: z.strictObject({ turn: uint, request_id: z.string() }),
  }),
  z.strictObject({ cancelling: z.strictObject({ turn: uint }) }),
  z.strictObject({
    failed: z.strictObject({
      turn: uint.nullable(),
      error: DesktopErrorSchema,
    }),
  }),
]);

const ResyncReasonSchema = z.enum([
  "event_gap",
  "progress_loss",
  "worker_degraded",
  "explicit_request",
]);

const DeliveryStatusSchema = z.strictObject({
  last_delivered_seq: uint,
  resync_required: z.boolean(),
  dropped_snapshots: uint,
  buffered_events: uint,
});

const ToolCallSchema = z.strictObject({
  tool_use_id: z.string(),
  name: z.string(),
  input: jsonValue,
});

const ToolResultStatusSchema = z.union([
  z.enum(["succeeded", "invalid_arguments", "unknown_tool", "denied", "outcome_unknown"]),
  z.strictObject({ failed: z.strictObject({ retryable: z.boolean() }) }),
  z.strictObject({
    cancelled: z.strictObject({
      reason: z.enum(["user", "parent", "hook", "disposed"]),
    }),
  }),
]);

const ToolContentSchema = z.union([
  z.strictObject({ text: z.string() }),
  z.strictObject({ json: jsonValue }),
]);

const ToolResultSchema = z.strictObject({
  tool_use_id: z.string(),
  name: z.string(),
  status: ToolResultStatusSchema,
  content: ToolContentSchema,
});

export type ContentBlock =
  | { kind: "text"; text: string }
  | { kind: "thinking"; thinking: string }
  | { kind: "tool_use"; id: string; name: string; input: z.infer<typeof jsonValue> }
  | {
      kind: "tool_result";
      tool_use_id: string;
      content: string | ContentBlock[];
    };

export const ContentBlockSchema: z.ZodType<ContentBlock> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("text"), text: z.string() }),
    z.strictObject({ kind: z.literal("thinking"), thinking: z.string() }),
    z.strictObject({
      kind: z.literal("tool_use"),
      id: z.string(),
      name: z.string(),
      input: jsonValue,
    }),
    z.strictObject({
      kind: z.literal("tool_result"),
      tool_use_id: z.string(),
      content: z.union([z.string(), z.array(ContentBlockSchema)]),
    }),
  ]),
);

const StopReasonSchema = z.union([
  z.enum(["end_turn", "tool_use", "max_tokens"]),
  z.strictObject({ other: z.string() }),
]);

const UsageSchema = z.strictObject({
  input_tokens: uint,
  output_tokens: uint,
});

const PendingBlockSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("text"), text: z.string() }),
  z.strictObject({ kind: z.literal("thinking"), thinking: z.string() }),
  z.strictObject({
    kind: z.literal("tool_use"),
    id: z.string(),
    name: z.string(),
    input_json: z.string(),
  }),
]);

const ModelResponseSnapshotSchema = z.strictObject({
  content: z.array(ContentBlockSchema),
  pending: PendingBlockSchema.nullable(),
  stop_reason: StopReasonSchema.nullable(),
  usage: UsageSchema.nullable(),
  model: z.string().nullable(),
});

const SessionItemBaseSchema = z.strictObject({
  id: z.string(),
  seq: uint,
  session_id: z.string(),
  turn: uint,
  at: z.string(),
});

const SessionItemSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("user_message"),
    base: SessionItemBaseSchema,
    text: z.string(),
  }),
  z.strictObject({
    kind: z.literal("assistant_message"),
    base: SessionItemBaseSchema,
    blocks: z.array(ContentBlockSchema),
  }),
  z.strictObject({
    kind: z.literal("tool_call"),
    base: SessionItemBaseSchema,
    call: ToolCallSchema,
  }),
  z.strictObject({
    kind: z.literal("tool_result"),
    base: SessionItemBaseSchema,
    result: ToolResultSchema,
  }),
  z.strictObject({
    kind: z.literal("compaction"),
    base: SessionItemBaseSchema,
    compaction_kind: z.enum(["prune", "tail_window", "summary"]),
    compaction_save_id: z.string().nullable(),
    excluded_item_ids: z.array(z.string()),
    before_tokens: uint.nullable(),
    after_tokens: uint.nullable(),
  }),
  z.strictObject({
    kind: z.literal("checkpoint_created"),
    base: SessionItemBaseSchema,
    checkpoint_id: z.string(),
  }),
]);

const SessionSnapshotSchema = z.strictObject({
  summary: z.strictObject({
    session_id: z.string(),
    cwd: z.string(),
    last_turn: uint.nullable(),
    item_count: uint,
  }),
  items: z.array(SessionItemSchema),
});

const ApprovalRequestSchema = z.strictObject({
  id: z.string(),
  turn: uint,
  call: ToolCallSchema,
  working_dir: z.string(),
});

const DesktopSnapshotSchema = z.strictObject({
  session: SessionSnapshotSchema,
  state: DesktopRunStateSchema,
  pending_approvals: z.array(ApprovalRequestSchema),
  active_assistant_calls: z.array(
    z.strictObject({ turn: uint, llm_call_id: z.string() }),
  ),
  delivery: DeliveryStatusSchema,
});

const ShutdownReportSchema = z.strictObject({
  cancelled_turn: uint.nullable(),
  progress_flushed: z.boolean(),
  diagnostic_log_flushed: z.boolean(),
});

const LlmCallOutcomeSchema = z.union([
  z.strictObject({
    succeeded: z.strictObject({
      stop_reason: StopReasonSchema,
      usage: UsageSchema.nullable(),
    }),
  }),
  z.strictObject({ failed: z.strictObject({ message: z.string() }) }),
  z.literal("cancelled"),
]);

export const DesktopResponseSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("handshake_accepted"),
    protocol_version: z.literal(DESKTOP_PROTOCOL_VERSION),
  }),
  z.strictObject({ kind: z.literal("session_ready"), snapshot: DesktopSnapshotSchema }),
  z.strictObject({ kind: z.literal("turn_accepted"), turn: uint }),
  z.strictObject({ kind: z.literal("cancellation_accepted"), turn: uint }),
  z.strictObject({ kind: z.literal("approval_accepted"), approval_id: z.string() }),
  z.strictObject({ kind: z.literal("snapshot"), snapshot: DesktopSnapshotSchema }),
  z.strictObject({
    kind: z.literal("shutdown_completed"),
    report: ShutdownReportSchema,
  }),
  z.strictObject({ kind: z.literal("rejected"), error: DesktopCommandErrorSchema }),
]);

export const DesktopProtocolEventSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("turn_started"), turn: uint }),
  z.strictObject({
    kind: z.literal("llm_call_started"),
    turn: uint,
    step: uint,
    llm_call_id: z.string(),
  }),
  z.strictObject({
    kind: z.literal("assistant_response_snapshot"),
    turn: uint,
    step: uint,
    llm_call_id: z.string(),
    update_index: uint,
    snapshot: ModelResponseSnapshotSchema,
  }),
  z.strictObject({ kind: z.literal("tool_call"), turn: uint, call: ToolCallSchema }),
  z.strictObject({ kind: z.literal("tool_result"), turn: uint, result: ToolResultSchema }),
  z.strictObject({
    kind: z.literal("llm_call_ended"),
    turn: uint,
    step: uint,
    llm_call_id: z.string(),
    outcome: LlmCallOutcomeSchema,
  }),
  z.strictObject({
    kind: z.literal("assistant_finalized"),
    turn: uint,
    llm_call_id: z.string(),
    blocks: z.array(ContentBlockSchema),
  }),
  z.strictObject({ kind: z.literal("turn_ended"), turn: uint }),
  z.strictObject({ kind: z.literal("state_changed"), state: DesktopRunStateSchema }),
  z.strictObject({ kind: z.literal("approval_requested"), request: ApprovalRequestSchema }),
  z.strictObject({ kind: z.literal("turn_completed"), turn: uint }),
  z.strictObject({ kind: z.literal("turn_failed"), turn: uint, error: DesktopErrorSchema }),
  z.strictObject({ kind: z.literal("resync_required"), reason: ResyncReasonSchema }),
  z.strictObject({ kind: z.literal("stopped"), report: ShutdownReportSchema }),
]);

const DesktopMessageSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("command"), command: DesktopCommandSchema }),
  z.strictObject({ kind: z.literal("response"), response: DesktopResponseSchema }),
  z.strictObject({ kind: z.literal("event"), event: DesktopProtocolEventSchema }),
]);

export const DesktopMessageEnvelopeSchema = z
  .strictObject({
    protocol_version: z.literal(DESKTOP_PROTOCOL_VERSION),
    connection_epoch: uint.nullable(),
    request_id: z.string().min(1).nullable(),
    seq: uint.nullable(),
    payload: DesktopMessageSchema,
  })
  .superRefine((envelope, context) => {
    const identityError = (message: string): void => {
      context.addIssue({ code: "custom", message });
    };

    switch (envelope.payload.kind) {
      case "command":
        if (envelope.request_id === null || envelope.seq !== null) {
          identityError("command requires request_id and forbids seq");
        }
        if (envelope.payload.command.kind === "handshake") {
          if (envelope.connection_epoch !== null) {
            identityError("handshake command must not provide connection_epoch");
          }
        } else if (envelope.connection_epoch === null) {
          identityError("session command requires connection_epoch");
        }
        break;
      case "response":
        if (
          envelope.request_id === null ||
          envelope.connection_epoch === null ||
          envelope.seq !== null
        ) {
          identityError("response requires request_id/connection_epoch and forbids seq");
        }
        break;
      case "event":
        if (
          envelope.request_id !== null ||
          envelope.connection_epoch === null ||
          envelope.seq === null
        ) {
          identityError("event requires connection_epoch/seq and forbids request_id");
        }
        break;
    }
  });

export type DesktopCommand = z.infer<typeof DesktopCommandSchema>;
export type DesktopCommandError = z.infer<typeof DesktopCommandErrorSchema>;
export type DesktopError = z.infer<typeof DesktopErrorSchema>;
export type DesktopRunState = z.infer<typeof DesktopRunStateSchema>;
export type ResyncReason = z.infer<typeof ResyncReasonSchema>;
export type DeliveryStatus = z.infer<typeof DeliveryStatusSchema>;
export type ToolCall = z.infer<typeof ToolCallSchema>;
export type ToolResult = z.infer<typeof ToolResultSchema>;
export type ModelResponseSnapshot = z.infer<typeof ModelResponseSnapshotSchema>;
export type SessionItem = z.infer<typeof SessionItemSchema>;
export type SessionSnapshot = z.infer<typeof SessionSnapshotSchema>;
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;
export type DesktopSnapshot = z.infer<typeof DesktopSnapshotSchema>;
export type ShutdownReport = z.infer<typeof ShutdownReportSchema>;
export type DesktopResponse = z.infer<typeof DesktopResponseSchema>;
export type DesktopProtocolEvent = z.infer<typeof DesktopProtocolEventSchema>;
export type DesktopMessageEnvelope = z.infer<typeof DesktopMessageEnvelopeSchema>;

export function parseDesktopMessageEnvelope(input: unknown): DesktopMessageEnvelope {
  return DesktopMessageEnvelopeSchema.parse(input);
}
