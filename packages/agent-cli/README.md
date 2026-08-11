# @moontide/agent-cli

MoonTide **CLI 产品**：REPL、slash 命令、statusline、Agent Event 的 stderr/JSONL **终端渲染**，以及 `AgentEventOutputs` 接线。agent run **须** 经 `@moontide/agent`（**禁止** direct import `@moontide/agent-core`）。边界说明：[`agent-harness-cli-split.md`](../../docs/notes/runtime/agent-harness-cli-split.md) §4。

## 四层包边界

| 包 | 唯一回答的问题 |
|----|----------------|
| `@moontide/llm` | 一次标准化 `LLMRequest` 应通过哪个 model / Provider route 执行，以及如何适配厂商 API 参数？ |
| `@moontide/agent-core` | 一个 LLM loop 下一步怎么运行，turn、tool 调用与固定 `RunEvent` 协议如何推进？ |
| `@moontide/agent` | 一个 MoonTide `AgentSession` 如何构建，Session、context preset、LLM、tools 与 hooks 如何装配？ |
| **`@moontide/agent-cli`（本包）** | 如何把 `@moontide/agent` 运行成 terminal REPL 产品？ |

运行调用链：`agent-cli → agent → agent-core → 注入的 StreamFn → agent stream-fn → llm adapter`。本包是 terminal Shell，只负责交互、进程启动与终端呈现；不实现 run loop，也不拥有 AgentSession/context 策略。

## 职责

- 进程入口：[`src/main.ts`](src/main.ts) → REPL（`cli/repl/`）
- **Bootstrap env**：`loadBootstrapEnv` — workspace `.env`、默认 `MOONTIDE_WORKDIR`
- **终端 IO**：`terminal/`、`i18n/`、statusline
- **Agent Event 终端渲染**：`log/format/`、`StderrRenderer`、`log/modes.ts`
- **错误终端输出**：`errors/report.ts`、`errors/cli.ts`（stderr 块 + debug emit）
- **Event outputs 工厂**：`createCliEventOutputs` — JsonlWriter + StderrRenderer + `reportError` + `writeDebugTerminal`

Harness 即 **`@moontide/agent`**（含 MoonTide Preset），不在本包。

## 不做什么（硬边界）

| 禁止 | 说明 |
|------|------|
| `@moontide/agent-core` | conformance 要求 agent-cli 零 core import |
| 自建 `runLoop` / `resolveRunConfig` | 经 `@moontide/agent` |
| Session Item 事实源 | 见 `@moontide/session` + Harness commit port |

## 谁应该用

| 角色 | 用法 |
|------|------|
| 终端用户 | `pnpm dev` / `pnpm start` |
| 测试 / evals | subpath：`bootstrap-env`、`cli-event-outputs` |
| 库消费者 | 本包 **无根 export**；仅下列 subpath |

## 对外 API

本包 **`private: true`**，面向 workspace 与 MoonTide 产品；以下 subpath 供装配与测试。

### package.json exports

| Subpath | 说明 |
|---------|------|
| `@moontide/agent-cli/bootstrap` | 加载 env 后 re-export Harness bootstrap（若使用） |
| `@moontide/agent-cli/bootstrap-env` | `loadBootstrapEnv`, `findWorkspaceRoot` |
| `@moontide/agent-cli/cli-event-outputs` | `createCliEventOutputs(workdir)` |
| `@moontide/agent-cli/log/setup` | `resetEventPlatform` re-export |

进程入口 **无** package export：`node dist/main.js` 或 `tsx src/main.ts`。

### createCliEventOutputs

构造 Harness 所需的 `AgentEventOutputs`：

- `outputs`: `JsonlWriter`（`.moontide/runs/`）+ `StderrRenderer`
- `publishError`: 委托 `reportError`（stderr + debug + Agent Event）
- `writeDebugTerminal`: debug 块 stderr（`writeStderrBlock`）

Slash **`/save`** · **`/resume session`** 在 [`src/cli/commands/session-save.ts`](src/cli/commands/session-save.ts) · [`resume.ts`](src/cli/commands/resume.ts)；Harness 只暴露 `saveActiveSessionToIndex` / `openSessionFromIndex`。

## 最小用法

### 开发 REPL

```bash
pnpm --filter @moontide/agent-cli run dev
# 或仓库根：pnpm dev
```

cwd 为 `packages/agent-cli`；`loadBootstrapEnv` 将默认 `MOONTIDE_WORKDIR` 设为 **workspace 根**（非 cwd）。

### 生产

```bash
pnpm --filter @moontide/agent-cli run build
pnpm --filter @moontide/agent-cli run start
```

### REPL 内 event outputs 注入（摘录）

```ts
import { bootstrapAgentPlatform, createAgentRuntime, getWorkdir } from "@moontide/agent";
import { createCliEventOutputs } from "../log/cli-event-outputs.js";

const workdir = getWorkdir();
await bootstrapAgentPlatform({
  runtime: createAgentRuntime(),
  workdir,
  eventOutputs: createCliEventOutputs(workdir),
});
```

见 [`src/cli/repl/run.ts`](src/cli/repl/run.ts)。

### 测试引用 bootstrap-env

```ts
import { loadBootstrapEnv } from "@moontide/agent-cli/bootstrap-env";
```

## 相关文档与验收

| 文档 / 测试 | 内容 |
|-------------|------|
| [`monorepo-packages.md`](../../docs/notes/runtime/monorepo-packages.md) | Dev 启动 · cwd · `.env` 约定 |
| [`agent-harness-cli-split.md`](../../docs/notes/runtime/agent-harness-cli-split.md) | §4 终端与观测边界 |
| [`tests/conformance/dev-startup.test.ts`](../../tests/conformance/dev-startup.test.ts) | bootstrap-env · tsx 链 |
| [`tests/conformance/architecture-boundaries.test.ts`](../../tests/conformance/architecture-boundaries.test.ts) | agent-cli 零 agent-core |
