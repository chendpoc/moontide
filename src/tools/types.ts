import type { ToolSchema } from "../llm/protocol/types.js";

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
}

export type ToolHandler = (
  input: Record<string, unknown>,
  ctx: ToolContext,
) => string | Promise<string>;

/** Registered tool: protocol schema + handler. */
export interface ToolDefinition {
  schema: ToolSchema;
  handler: ToolHandler;
}
