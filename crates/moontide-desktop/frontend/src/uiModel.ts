import type {
  ContentBlock,
  DesktopRunState,
  ModelResponseSnapshot,
  ToolResult,
} from "./protocol";
import type {
  AssistantDraftView,
  MessageView,
  RenderState,
  ToolView,
} from "./renderState";
import type { ConnectionState } from "./controller";

export type CommandPhase = "idle" | "submitting" | "cancelling" | "approval";
export type ComposerMode = "editable" | "active" | "submitting" | "cancelling" | "disabled";

export function runStateKind(run: DesktopRunState): string {
  if (typeof run === "string") {
    return run;
  }
  return Object.keys(run)[0] ?? "unknown";
}

export function runStateLabel(run: DesktopRunState): string {
  if (typeof run === "string") {
    return capitalize(run);
  }
  if ("thinking" in run) {
    return `Thinking · turn ${run.thinking.turn} · step ${run.thinking.step}`;
  }
  if ("running_tool" in run) {
    return `Running ${run.running_tool.name}`;
  }
  if ("waiting_approval" in run) {
    return "Waiting for approval";
  }
  if ("cancelling" in run) {
    return "Cancelling";
  }
  if ("failed" in run) {
    return "Failed";
  }
  return "Unknown";
}

export function connectionLabel(connection: ConnectionState): string {
  switch (connection.kind) {
    case "starting":
      return "Connecting";
    case "ready":
      return "Connected";
    case "degraded":
      return "Shutdown degraded";
    case "disconnected":
      return "Disconnected";
  }
}

export function composerMode(
  connection: ConnectionState,
  run: DesktopRunState,
  phase: CommandPhase,
): ComposerMode {
  if (connection.kind !== "ready") {
    return "disabled";
  }
  if (phase === "cancelling") {
    return "cancelling";
  }
  if (phase === "submitting") {
    return "submitting";
  }

  const kind = runStateKind(run);
  if (kind === "idle" || kind === "failed") {
    return "editable";
  }
  if (kind === "thinking" || kind === "running_tool" || kind === "waiting_approval") {
    return "active";
  }
  if (kind === "cancelling" || kind === "stopping") {
    return "cancelling";
  }
  return "disabled";
}

export function allowsApproval(
  connection: ConnectionState,
  run: DesktopRunState,
  phase: CommandPhase,
): boolean {
  return (
    connection.kind === "ready" &&
    phase === "idle" &&
    runStateKind(run) === "waiting_approval"
  );
}

export function blocksText(blocks: ContentBlock[]): string {
  return blocks
    .flatMap((block) => {
      switch (block.kind) {
        case "text":
          return [block.text];
        case "thinking":
          return [];
        case "tool_use":
          return [`tool: ${block.name}`];
        case "tool_result":
          return ["tool result"];
      }
    })
    .filter((text) => text.length > 0)
    .join("\n");
}

export function snapshotText(snapshot: ModelResponseSnapshot): string {
  const visible = blocksText(snapshot.content);
  const pending = snapshot.pending;
  if (pending === null || pending.kind === "thinking") {
    return visible;
  }
  const pendingText =
    pending.kind === "text" ? pending.text : `tool: ${pending.name}`;
  return [visible, pendingText].filter((text) => text.length > 0).join("\n");
}

export function orderedDrafts(state: RenderState): AssistantDraftView[] {
  return Object.values(state.assistantDrafts).sort(
    (left, right) =>
      left.turn - right.turn ||
      left.step - right.step ||
      left.llmCallId.localeCompare(right.llmCallId),
  );
}

export function liveTools(state: RenderState): ToolView[] {
  const historical = new Set(
    state.messages.flatMap((message: MessageView) => {
      if (message.kind === "tool_call") {
        return [message.call.tool_use_id];
      }
      if (message.kind === "tool_result") {
        return [message.result.tool_use_id];
      }
      return [];
    }),
  );
  return Object.values(state.tools)
    .filter((tool) => !historical.has(tool.call.tool_use_id))
    .sort((left, right) => left.call.tool_use_id.localeCompare(right.call.tool_use_id));
}

export function toolStatusLabel(result: ToolResult | null): string {
  if (result === null) {
    return "running";
  }
  if (typeof result.status === "string") {
    return result.status.replaceAll("_", " ");
  }
  if ("failed" in result.status) {
    return result.status.failed.retryable ? "failed · retryable" : "failed";
  }
  return `cancelled · ${result.status.cancelled.reason}`;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase()}${value.slice(1)}`;
}
