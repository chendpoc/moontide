import { ErrorCode } from "./codes.js";
import { toMessage } from "./normalize.js";

const TOOL_ERROR_PREFIX = "Error: ";

export type ToolOutcomeForErrorCode =
  | { status: "denied" }
  | { status: "rejected" }
  | { status: "failed"; error: string }
  | { status: "succeeded" };

export function toolFailureMessage(message: string): string {
  return `${TOOL_ERROR_PREFIX}${message}`;
}

export function toFailureOutcome(err: unknown): { status: "failed"; error: string } {
  return { status: "failed", error: toMessage(err) };
}

export function errorCodeFromToolOutcome(outcome: ToolOutcomeForErrorCode): ErrorCode {
  switch (outcome.status) {
    case "denied":
    case "rejected":
      return ErrorCode.PERMISSION;
    case "failed":
      return ErrorCode.TOOL;
    case "succeeded":
      return ErrorCode.INTERNAL;
  }
}
