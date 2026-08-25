import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type { DesktopBridge } from "./controller";

const ENVELOPE_EVENT = "desktop-envelope";
const CONNECTION_EVENT = "desktop-connection";

export function createTauriBridge(): DesktopBridge {
  return {
    request(command) {
      return invoke<unknown>("desktop_request", { command });
    },
    listenEnvelope(listener) {
      return listen<unknown>(ENVELOPE_EVENT, (event) => listener(event.payload));
    },
    listenConnection(listener) {
      return listen<unknown>(CONNECTION_EVENT, (event) => listener(event.payload));
    },
  };
}
