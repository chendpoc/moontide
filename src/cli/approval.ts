export interface ToolApprovalContext {
  toolName: string;
  toolInput: Record<string, unknown>;
  turn: number;
}

export type ToolApprovalPrompt = (ctx: ToolApprovalContext) => Promise<boolean>;

let promptFn: ToolApprovalPrompt | null = null;

export function setToolApprovalPrompt(fn: ToolApprovalPrompt | null): void {
  promptFn = fn;
}

export function isApprovalConfigured(): boolean {
  return promptFn !== null;
}

export async function promptToolApproval(ctx: ToolApprovalContext): Promise<boolean> {
  if (!promptFn) {
    return false;
  }
  return promptFn(ctx);
}
