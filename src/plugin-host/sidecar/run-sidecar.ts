#!/usr/bin/env node
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

import {
  defineSidecarPlugin,
  listSidecarHooks,
  listSidecarTools,
  resolveSidecarHookEntry,
  type SidecarPluginDefinition,
} from "../../plugin-sdk/define.js";
import type { HookPhase } from "../../agent/hooks/phases.js";
import {
  encodeSidecarMessage,
  parseSidecarMessage,
  type HostToSidecarMessage,
} from "./protocol.js";
import { createHostMessageHandlers, dispatchHostMessage } from "./message-handlers.js";

let plugin: SidecarPluginDefinition | null = null;
let pluginId = process.env.OCULA_SIDECAR_PLUGIN_ID ?? "sidecar";

async function loadEntry(entryPath: string): Promise<SidecarPluginDefinition> {
  const mod = (await import(pathToFileURL(entryPath).href)) as {
    default?: SidecarPluginDefinition;
    plugin?: SidecarPluginDefinition;
  };
  return defineSidecarPlugin(mod.default ?? mod.plugin ?? {});
}

function send(message: Record<string, unknown>): void {
  process.stdout.write(encodeSidecarMessage(message as never));
}

async function handleInit(message: Extract<HostToSidecarMessage, { type: "init" }>): Promise<void> {
  pluginId = message.pluginId;
  const entryPath = process.argv[2];
  if (!entryPath) {
    send({ type: "error", message: "Missing sidecar entry path" });
    process.exit(1);
  }
  plugin = await loadEntry(entryPath);
  send({
    type: "ready",
    pluginId,
    hooks: listSidecarHooks(plugin),
    tools: listSidecarTools(plugin).map((tool) => ({
      name: tool.name,
      schema: tool.schema,
    })),
  });
}

async function handleHook(
  message: Extract<HostToSidecarMessage, { type: "hook" }>,
): Promise<void> {
  const entry = plugin?.hooks?.[message.phase as HookPhase]?.[message.name];
  if (!entry) {
    send({ type: "hook_result", id: message.id, result: undefined });
    return;
  }
  try {
    const { handler } = resolveSidecarHookEntry(entry);
    const result = await handler(message.ctx as never);
    send({ type: "hook_result", id: message.id, result });
  } catch (err) {
    send({
      type: "error",
      id: message.id,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

async function handleTool(
  message: Extract<HostToSidecarMessage, { type: "tool" }>,
): Promise<void> {
  const tool = plugin?.tools?.[message.name];
  if (!tool) {
    send({ type: "error", id: message.id, message: `Unknown tool: ${message.name}` });
    return;
  }
  try {
    const output = await tool.handler(message.input, {
      workdir: process.cwd(),
      userInteraction: {
        approveTool: async () => true,
        askQuestion: async () => [],
      },
    });
    send({ type: "tool_result", id: message.id, output });
  } catch (err) {
    send({
      type: "error",
      id: message.id,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

const HOST_MESSAGE_HANDLERS = createHostMessageHandlers({
  init: handleInit,
  hook: handleHook,
  tool: handleTool,
  shutdown: () => {
    process.exit(0);
  },
});

export async function runSidecarProcess(): Promise<void> {
  process.stdin.on("close", () => {
    process.exit(0);
  });

  const rl = createInterface({ input: process.stdin });
  rl.on("line", async (line) => {
    if (!line.trim()) {
      return;
    }
    const message = parseSidecarMessage(line) as HostToSidecarMessage;
    await dispatchHostMessage(HOST_MESSAGE_HANDLERS, message);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void runSidecarProcess();
}
