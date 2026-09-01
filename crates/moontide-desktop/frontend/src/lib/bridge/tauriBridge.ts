import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type { DesktopBridge } from "$lib/controller/index.js";
import {
  parseDesktopResponse,
  type DesktopResponse,
} from "$lib/protocol/index.js";

const ENVELOPE_EVENT = "desktop-envelope";
const CONNECTION_EVENT = "desktop-connection";

export function createTauriBridge(): DesktopBridge {
  return {
    async listSessions(): Promise<DesktopResponse> {
      return parseDesktopResponse(await invoke<unknown>("list_sessions"));
    },
    async newChat(): Promise<DesktopResponse> {
      return parseDesktopResponse(await invoke<unknown>("new_chat"));
    },
    async createSession(): Promise<DesktopResponse> {
      return parseDesktopResponse(await invoke<unknown>("create_session"));
    },
    async startSession(sessionId: string): Promise<DesktopResponse> {
      return parseDesktopResponse(await invoke<unknown>("start_session", { sessionId }));
    },
    async loadSessionHistory(
      sessionId: string,
      beforeTurn: number,
      limit: number,
    ): Promise<DesktopResponse> {
      return parseDesktopResponse(
        await invoke<unknown>("load_session_history", { sessionId, beforeTurn, limit }),
      );
    },
    async submitTurn(sessionId: string, text: string): Promise<DesktopResponse> {
      return parseDesktopResponse(
        await invoke<unknown>("submit_turn", { sessionId, text }),
      );
    },
    async cancelTurn(): Promise<DesktopResponse> {
      return parseDesktopResponse(await invoke<unknown>("cancel_turn"));
    },
    async approve(approvalId: string): Promise<DesktopResponse> {
      return parseDesktopResponse(await invoke<unknown>("approve", { approvalId }));
    },
    async deny(approvalId: string, reason: string): Promise<DesktopResponse> {
      return parseDesktopResponse(await invoke<unknown>("deny", { approvalId, reason }));
    },
    async snapshot(): Promise<DesktopResponse> {
      return parseDesktopResponse(await invoke<unknown>("snapshot"));
    },
    async shutdown(): Promise<DesktopResponse> {
      return parseDesktopResponse(await invoke<unknown>("shutdown"));
    },
    listenEnvelope(listener) {
      return listen<unknown>(ENVELOPE_EVENT, (event) => listener(event.payload));
    },
    listenConnection(listener) {
      return listen<unknown>(CONNECTION_EVENT, (event) => listener(event.payload));
    },
  };
}
