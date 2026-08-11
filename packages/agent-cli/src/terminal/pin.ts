let onExternalWrite: (() => void) | null = null;

export function setExternalStderrWriteHandler(handler: (() => void) | null): void {
  onExternalWrite = handler;
}

export function notifyExternalStderrWrite(): void {
  onExternalWrite?.();
}
