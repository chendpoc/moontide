import { internalError } from "@moontide/shared/errors/factories.js";

export interface InspectContextPort {
  inspect(detail: string, exact: boolean): Promise<string>;
}

let inspectPort: InspectContextPort | undefined;

export function setInspectContextPort(next: InspectContextPort): void {
  inspectPort = next;
}

export function getInspectContextPort(): InspectContextPort {
  if (!inspectPort) {
    throw internalError("InspectContext port is not set");
  }
  return inspectPort;
}
