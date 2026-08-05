import { ErrorCode } from "./codes.js";
import { isAppError } from "./app-error.js";

export function toMessage(err: unknown): string {
  if (isAppError(err)) {
    return err.message;
  }
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  return String(err);
}

export function toStack(err: unknown): string | undefined {
  if (err instanceof Error && err.stack) {
    return err.stack;
  }
  return undefined;
}

export function errorCodeOf(err: unknown): ErrorCode {
  if (isAppError(err)) {
    return err.code;
  }
  return ErrorCode.INTERNAL;
}
