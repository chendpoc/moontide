import { APP_ENV, envVarName } from "@moontide/shared/constants/env.js";
import { infraError } from "@moontide/shared/errors/factories.js";
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { dirname, joinPath } from "@moontide/shared/utils/path.js";
import type { SidecarHookSpec, SidecarToolSpec } from "../types.js";
import {
  encodeSidecarMessage,
  parseSidecarMessage,
  type HostToSidecarMessage,
  type SidecarToHostMessage,
} from "./protocol.js";
import {
  createSidecarResponseHandlers,
  dispatchSidecarResponse,
  resolvePendingResponse,
} from "./message-handlers.js";

const RUNNER = joinPath(dirname(fileURLToPath(import.meta.url)), "run-sidecar.js");

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export class SidecarProcessTransport {
  private child: ChildProcess | null = null;
  private pending = new Map<string, PendingRequest>();
  private readyResolve:
    | ((value: { hooks: SidecarHookSpec[]; tools: SidecarToolSpec[] }) => void)
    | null = null;
  private readyReject: ((error: Error) => void) | null = null;
  private nextId = 0;

  constructor(
    readonly pluginId: string,
    readonly entryPath: string,
  ) {}

  async start(workdir: string): Promise<void> {
    this.child = spawn(process.execPath, [RUNNER, this.entryPath], {
      cwd: workdir,
      stdio: ["pipe", "pipe", "inherit"],
      env: { ...process.env, [envVarName(APP_ENV.SIDECAR_PLUGIN_ID)]: this.pluginId },
    });

    const stdout = this.child.stdout;
    if (!stdout) {
      throw infraError("Sidecar process missing stdout", {
        context: { pluginId: this.pluginId, transport: "stdio" },
      });
    }

    const rl = createInterface({ input: stdout });
    rl.on("line", (line) => {
      this.handleLine(line);
    });

    this.child.on("exit", (code) => {
      const err = new Error(`Sidecar process exited with code ${code ?? "unknown"}`);
      this.readyReject?.(err);
      for (const pending of this.pending.values()) {
        pending.reject(err);
      }
      this.pending.clear();
    });

    this.send({ type: "init", pluginId: this.pluginId, workdir });
  }

  private send(message: HostToSidecarMessage): void {
    this.child?.stdin?.write(encodeSidecarMessage(message));
  }

  private handleLine(line: string): void {
    if (!line.trim()) {
      return;
    }
    const message = parseSidecarMessage(line) as SidecarToHostMessage;
    dispatchSidecarResponse(this.responseHandlers, message);
  }

  private readonly responseHandlers = createSidecarResponseHandlers({
    ready: (message) => {
      if (message.pluginId !== this.pluginId) {
        return;
      }
      this.readyResolve?.({ hooks: message.hooks, tools: message.tools });
      this.readyResolve = null;
      this.readyReject = null;
    },
    resolvePending: (message) => resolvePendingResponse(this.pending, message),
  });

  waitForReady(): Promise<{ hooks: SidecarHookSpec[]; tools: SidecarToolSpec[] }> {
    return new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
      setTimeout(() => reject(new Error("Sidecar ready timeout")), 10_000);
    });
  }

  private request<T>(message: HostToSidecarMessage & { id: string }): Promise<T> {
    return new Promise((resolve, reject) => {
      this.pending.set(message.id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.send(message);
    });
  }

  dispatchHook(phase: string, name: string, ctx: unknown): Promise<unknown> {
    const id = `hook-${this.nextId++}`;
    return this.request({ type: "hook", id, phase, name, ctx });
  }

  dispatchTool(name: string, input: Record<string, unknown>): Promise<string> {
    const id = `tool-${this.nextId++}`;
    return this.request<string>({ type: "tool", id, name, input });
  }

  async shutdown(): Promise<void> {
    this.send({ type: "shutdown" });
    this.child?.kill();
    this.child = null;
  }
}
