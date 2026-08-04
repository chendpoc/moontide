import { pathToFileURL } from "node:url";

import type { AgentRuntime } from "../../agent/runtime/index.js";
import type { HookPhase } from "../../agent/hooks/phases.js";
import type { StepObserveResult } from "../../agent/hooks/types.js";
import type { ToolSchema } from "../../llm/protocol/types.js";
import {
  defineSidecarPlugin,
  listSidecarTools,
  resolveSidecarHookEntry,
  type SidecarPluginDefinition,
} from "../../plugin-sdk/define.js";
import type { ToolDefinition } from "../../tools/types.js";
import { resolvePath } from "../../utils/path.js";
import type { SidecarHookSpec, SidecarToolSpec } from "../types.js";
import type { SidecarTransport } from "../types.js";
import { SidecarProcessTransport } from "./process-transport.js";

function hookHandlerName(pluginId: string, name: string): string {
  return `${pluginId}/${name}`;
}

function registerInProcessPlugin(
  pluginId: string,
  definition: SidecarPluginDefinition,
  runtime: AgentRuntime,
): () => void {
  const hookDisposers: Array<() => void> = [];
  const hooks = runtime.hookRegistry.sidecar();

  for (const [phase, handlers] of Object.entries(definition.hooks ?? {})) {
    for (const [name, entry] of Object.entries(handlers ?? {})) {
      const resolved = resolveSidecarHookEntry(entry);
      hookDisposers.push(
        hooks.on(
          phase as HookPhase,
          hookHandlerName(pluginId, name),
          resolved.handler,
          { order: resolved.order, errorPolicy: resolved.errorPolicy },
        ),
      );
    }
  }

  const tools: ToolDefinition[] = listSidecarTools(definition).map((tool) => ({
    schema: {
      ...tool.schema,
      name: runtime.tools.pluginToolName(pluginId, tool.name),
    },
    handler: tool.handler,
    permission: tool.permission ?? { kind: "fixed", decision: "deny" },
  }));
  const removeTools = runtime.tools.addPluginTools(tools);

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
    private readonly runtime: AgentRuntime,
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
    const hooks = this.runtime.hookRegistry.sidecar();
    for (const spec of hookSpecs) {
      this.hookDisposers.push(
        hooks.on(
          spec.phase as HookPhase,
          hookHandlerName(this.pluginId, spec.name),
          async (ctx) =>
            (await this.transport!.dispatchHook(
              spec.phase as HookPhase,
              spec.name,
              ctx,
            )) as StepObserveResult,
          { order: spec.order, errorPolicy: spec.errorPolicy },
        ),
      );
    }

    const tools: ToolDefinition[] = toolSpecs.map((tool) => ({
      schema: {
        ...(tool.schema as unknown as ToolSchema),
        name: this.runtime.tools.pluginToolName(this.pluginId, tool.name),
      },
      handler: async (input) => this.transport!.dispatchTool(tool.name, input),
      permission: { kind: "fixed", decision: "deny" },
    }));
    this.removeTools = this.runtime.tools.addPluginTools(tools);
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
  runtime: AgentRuntime,
): () => void {
  return registerInProcessPlugin(pluginId, definition, runtime);
}
