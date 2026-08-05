export const ErrorCode = {
  VALIDATION: "validation",
  CONFIG: "config",
  TOOL: "tool",
  INFRA: "infra",
  INTERNAL: "internal",
  PERMISSION: "permission",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export function cliExitCodeFor(code: ErrorCode): number {
  return code === ErrorCode.CONFIG ? 1 : 1;
}
