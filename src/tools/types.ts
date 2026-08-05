import type { ToolSchema } from "../llm/protocol/types.js";
import type { ToolRegistryPort } from "./registry-port.js";

export type PermissionDecision = "allow" | "deny" | "ask";

export type ToolCapability = "read" | "write" | "network" | "exec" | "mixed";

export type ToolPermissionRule =
  | { kind: "fixed"; decision: PermissionDecision }
  | { kind: "bash"; field: "command" }
  | { kind: "path"; field: "path" };

/** Injected into tool handlers via ToolContext. */
export interface UserInteraction {
  approveTool(ctx: { toolName: string; input: Record<string, unknown> }): Promise<boolean>;
  askQuestion(input: {
    title?: string;
    questions: Array<{
      id: string;
      prompt: string;
      options: Array<{ id: string; label: string }>;
      allow_multiple?: boolean;
    }>;
  }): Promise<Array<{ question_id: string; selected: string[] }>>;
}

/** Passed to tool handlers alongside input. */
export interface ToolContext {
  workdir: string;
  userInteraction: UserInteraction;
  /** Current session — required for session-scoped tools such as read_artifact. */
  sessionId?: string;
  /** Present when invoked via agent harness; sidecar plugins may omit. */
  runtime?: {
    tools: ToolRegistryPort;
  };
}

export type ToolHandler = (
  input: Record<string, unknown>,
  ctx: ToolContext,
) => string | Promise<string>;

/** Registered tool: protocol schema + handler + permission rule. */
export interface ToolDefinition {
  schema: ToolSchema;
  handler: ToolHandler;
  permission: ToolPermissionRule;
  capability: ToolCapability;
}
