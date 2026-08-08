import type {
  AgentMessage,
  RunConfig,
  RunConfigSource,
  StreamFn,
  ToolExecutor,
  UserMessage,
} from "@moontide/agent-common";
import { createMessageLog } from "./message-log.js";
import { runLoop, type RunLoopResult } from "./loop.js";
import { resolveRunConfig } from "./resolve-run-config.js";
import { createRunEventBus, type RunEventBus, type RunEventListener } from "./run-event-bus.js";
import { RunAbortError } from "./lifecycle.js";

export interface AgentOptions {
  config: RunConfig;
  configSources?: RunConfigSource[];
  streamFn: StreamFn;
  toolExecutor: ToolExecutor;
  system?: string;
  tools?: readonly unknown[];
}

export class Agent {
  private readonly eventBus: RunEventBus;
  private readonly log = createMessageLog();
  private readonly options: AgentOptions;
  private activeRun: Promise<RunLoopResult> | null = null;
  private abortController: AbortController | null = null;

  constructor(options: AgentOptions) {
    this.options = options;
    this.eventBus = createRunEventBus();
  }

  subscribe(listener: RunEventListener): () => void {
    return this.eventBus.subscribe(listener);
  }

  get messages(): readonly AgentMessage[] {
    return this.log.messages;
  }

  abort(): void {
    this.abortController?.abort();
  }

  async waitForIdle(): Promise<void> {
    if (this.activeRun) {
      await this.activeRun.catch(() => undefined);
    }
  }

  async prompt(text: string): Promise<RunLoopResult> {
    if (this.activeRun) {
      throw new Error("Agent run already active");
    }
    const userMessage: UserMessage = {
      role: "user",
      content: text,
      timestamp: Date.now(),
    };
    return this._startRun([userMessage]);
  }

  private _startRun(prompts: UserMessage[]): Promise<RunLoopResult> {
    const config = resolveRunConfig(this.options.config, ...(this.options.configSources ?? []));
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const run = runLoop({
      eventBus: this.eventBus,
      log: this.log,
      config,
      streamFn: this.options.streamFn,
      toolExecutor: this.options.toolExecutor,
      llmDefaults: { system: this.options.system, tools: this.options.tools },
      prompts,
      signal,
    }).finally(() => {
      this.activeRun = null;
      this.abortController = null;
    });

    this.activeRun = run;
    return run;
  }
}

export { RunAbortError, type RunLoopResult };
