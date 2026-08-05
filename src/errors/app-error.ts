import type { ErrorCode } from "./codes.js";

export interface AppErrorOptions {
  cause?: unknown;
  context?: Record<string, unknown>;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly context?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, options?: AppErrorOptions) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.context = options?.context;
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
