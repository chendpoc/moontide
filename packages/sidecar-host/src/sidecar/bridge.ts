import { pathToFileURL } from "node:url";

import type { ToolSchema } from "@moontide/llm/protocol";
import {
  defineSidecarPlugin,
  listSidecarTools,
  resolveSidecarHookEntry,
  type SidecarPluginDefinition,
} from "@moontide/plugins-sdk";
import type { ToolDefinition } from "@moontide/tools";
import { resolvePath } from "@moontide/shared/utils/path.js";
import type { SidecarHostRuntimePort } from "../ports/runtime.js";
import type { SidecarHookSpec, SidecarToolSpec, SidecarTransport } from "../types.js";
import { SidecarProcessTransport } from "./process-transport.js";

function hookHandlerName(pluginId: string, name: string): string {
  return `${pluginId}/${name}`;
}

function registerInProcessPlugin(
  pluginId: string,
  definition: SidecarPluginDefinition,
  runtime: SidecarHostRuntimePort,
): () => void {
  const hookDisposers: Array<() => void> = [];
  const observers = runtime.sidecarObservers();

  for (const [phase, handlers] of Object.entries(definition.hooks ?? {})) {
    for (const [name, entry] of Object.entries(handlers ?? {})) {
      const resolved = resolveSidecarHookEntry(entry);
      hookDisposers.push(
        observers.on(phase, hookHandlerName(pluginId, name), resolved.handler, {
          order: resolved.order,
          errorPolicy: resolved.errorPolicy,
        }),
      );
    }
  }

  const tools: ToolDefinition[] = listSidecarTools(definition).map((tool) => ({
    schema: {
      ...tool.schema,
      name: runtime.pluginToolName(pluginId, tool.name),
    },
    handler: tool.handler,
    permission: tool.permission ?? { kind: "fixed", decision: "deny" },
    capability: tool.capability ?? "mixed",
  }));
  const removeTools = runtime.addPluginTools(tools);

  return () => {
    for (const dispose of hookDisposers) {
      dispose();
    }
    removeTools();
  };
}

export class SidecarBridge {
  private transport: SidecarProcessTransport | null = null;
  private hookDisposers: Array<() => void> = [];
  private removeTools: (() => void) | null = null;

  constructor(
    readonly pluginId: string,
    readonly workdir: string,
    private readonly runtime: SidecarHostRuntimePort,
  ) {}

  async connect(entry: string, transport: SidecarTransport = "in-process"): Promise<() => void> {
    const entryPath = resolvePath(this.workdir, entry);

    if (transport === "in-process") {
      const moduleUrl = pathToFileURL(entryPath).href;
      const mod = (await import(moduleUrl)) as {
        default?: SidecarPluginDefinition;
        plugin?: SidecarPluginDefinition;
      };
      const definition = defineSidecarPlugin(mod.default ?? mod.plugin ?? {});
      const dispose = registerInProcessPlugin(this.pluginId, definition, this.runtime);
      return () => {
        dispose();
      };
    }

    this.transport = new SidecarProcessTransport(this.pluginId, entryPath);
    const ready = this.transport.waitForReady();
    await this.transport.start(this.workdir);
    const { hooks, tools } = await ready;
    this.registerRemote(hooks, tools);
    return () => this.disconnect();
  }

  private registerRemote(hookSpecs: SidecarHookSpec[], toolSpecs: SidecarToolSpec[]): void {
    const observers = this.runtime.sidecarObservers();
    for (const spec of hookSpecs) {
      this.hookDisposers.push(
        observers.on(
          spec.phase,
          hookHandlerName(this.pluginId, spec.name),
          async (ctx) => this.transport!.dispatchHook(spec.phase, spec.name, ctx),
          { order: spec.order, errorPolicy: spec.errorPolicy },
        ),
      );
    }

    const tools: ToolDefinition[] = toolSpecs.map((tool) => ({
      schema: {
        ...(tool.schema as unknown as ToolSchema),
        name: this.runtime.pluginToolName(this.pluginId, tool.name),
      },
      handler: async (input) => this.transport!.dispatchTool(tool.name, input),
      permission: { kind: "fixed", decision: "deny" },
      capability: "mixed",
    }));
    this.removeTools = this.runtime.addPluginTools(tools);
  }

  disconnect(): void {
    for (const dispose of this.hookDisposers) {
      dispose();
    }
    this.hookDisposers = [];
    this.removeTools?.();
    this.removeTools = null;
    void this.transport?.shutdown();
    this.transport = null;
  }
}

export function attachInProcessSidecar(
  pluginId: string,
  definition: SidecarPluginDefinition,
  runtime: SidecarHostRuntimePort,
): () => void {
  return registerInProcessPlugin(pluginId, definition, runtime);
}
