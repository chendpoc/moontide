import type { ErrorCode } from "./codes.js";
import { ErrorCode as Codes } from "./codes.js";
import { isAppError } from "./app-error.js";
import { errorCodeOf, toMessage, toStack } from "./normalize.js";

export interface ErrorRecord {
  code: ErrorCode;
  message: string;
  source: string;
  runId?: string;
  turn?: number;
  toolName?: string;
  toolUseId?: string;
  hook?: string;
  phase?: string;
  context?: Record<string, unknown>;
  stack?: string;
  cause?: string;
}

function causeMessage(cause: unknown): string | undefined {
  if (cause === undefined || cause === null) {
    return undefined;
  }
  return toMessage(cause);
}

export function toErrorRecord(
  err: unknown,
  source: string,
  extras: Partial<Omit<ErrorRecord, "code" | "message" | "source">> = {},
): ErrorRecord {
  const code = errorCodeOf(err);
  const message = toMessage(err);
  const stack = toStack(err);
  const context = isAppError(err) ? err.context : extras.context;
  const cause =
    extras.cause ??
    (err instanceof Error && err.cause !== undefined ? causeMessage(err.cause) : undefined);

  return {
    ...extras,
    code,
    message,
    source,
    context,
    stack,
    cause,
  };
}

export function errorRecordToEventPayload(record: ErrorRecord): Record<string, unknown> {
  return {
    errorCode: record.code,
    message: record.message,
    source: record.source,
    runId: record.runId,
    toolName: record.toolName,
    toolUseId: record.toolUseId,
    hook: record.hook,
    phase: record.phase,
    context: record.context,
    stack: record.stack,
    cause: record.cause,
  };
}

export function isErrorRecord(value: unknown): value is ErrorRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as ErrorRecord;
  return typeof item.code === "string" && typeof item.message === "string" && typeof item.source === "string";
}

export { Codes as ErrorCodes };
