# @moontide/agent-core

Agent **时序内核（Temporal core）**：唯一决定 run 下一步——`runLoop`、RunEvent bus、`resolveRunConfig`、`resolveTurnContext`。设计 Spec：[`docs/spec/agent-core.md`](../../docs/spec/agent-core.md) · 术语 [`AGENTS.md`](../../AGENTS.md) §7.2。

## 四层包边界

| 包 | 唯一回答的问题 |
|----|----------------|
| `@moontide/llm` | 一次标准化 `LLMRequest` 应通过哪个 model / Provider route 执行，以及如何适配厂商 API 参数？ |
| **`@moontide/agent-core`（本包）** | 一个 LLM loop 下一步怎么运行，turn、tool 调用与固定 `RunEvent` 协议如何推进？ |
| `@moontide/agent` | 一个 MoonTide `AgentSession` 如何构建，Session、context preset、LLM、tools 与 hooks 如何装配？ |
| `@moontide/agent-cli` | 如何把 `@moontide/agent` 运行成 terminal REPL 产品？ |

运行调用链：`agent-cli → agent → agent-core → 注入的 StreamFn → agent stream-fn → llm adapter`。Core 只解释固定的 `RunConfig` / `RunEvent` 契约，不直接依赖 `@moontide/llm`；插件不能注册新的 lifecycle phase，产品级 prompt 与 context 构建也不在本包。

## 职责

- **runLoop**：turn 循环（LLM → tool → 停止判定）
- **RunEvent bus**：loop **publish** 语义事件；订阅者与 EventOutput **subscribe**（进程内 pub/sub 门面）
- **resolveRunConfig**：run 开始前合并并 freeze `RunConfig`（决策回调 + transform/convert）
- **resolveTurnContext**：每 turn、每次 LLM 前执行 `transformContext` → `convertToLlm`
- **lifecycle**：`withRun` / `withTurn` 配对 run/turn 生命周期事件
- **Effect 编排**：`streamAssistantResponse`、`executeToolCalls`（经注入的 `StreamFn` / `ToolExecutor`）

依赖 **`@moontide/run-protocol`** 的类型与 port 签名；不感知 MoonTide Session、compose、tools 注册表。

## 不做什么（硬边界）

| 禁止 import / 职责 | 说明 |
|--------------------|------|
| `@moontide/session` · `@moontide/context-composer` | **compile** / **materialize** 在 Harness 与 `@moontide/context-composer` |
| `@moontide/tools` · sidecar | tool 注册与执行 **实现** 在 Harness 注入的 `ToolExecutor` |
| terminal · stderr | 终端 stderr 输出不在 core |
| Session Item 写入 | 经 harness `RunCommitPort` / MessageCommitEffect |

门禁：[`packages/agent-core/tests/boundary.test.ts`](tests/boundary.test.ts) · [`tests/conformance/architecture-boundaries.test.ts`](../../tests/conformance/architecture-boundaries.test.ts)。

## 包依赖顺序

```
@moontide/agent-cli → @moontide/agent → @moontide/agent-core → @moontide/run-protocol
```

Harness 向 core 注入 `StreamFn`、`ToolExecutor` 与已 resolve 的 `RunConfig`；core **不** 写 Agent Event JSONL（由 Harness + `@moontide/log` 负责）。

## 谁应该用

| 调用方 | 用途 |
|--------|------|
| `@moontide/agent` | 生产 Harness 装配 `Agent`、`AgentRun` |
| 单元 / golden 测试 | 直接测 `runLoop` + mock port（`@moontide/agent-core/testing`） |
| `@moontide/agent-cli` | **不应** direct import |

## 对外 API

### package.json exports

| Subpath | 稳定性 |
|---------|--------|
| `@moontide/agent-core` | 稳定（workspace 内） |
| `@moontide/agent-core/testing` | **测试 / dev-only**，不承诺 semver |

### 稳定符号（根 export）

| 类别 | 符号 |
|------|------|
| 入口 | `Agent`, `AgentOptions`, `runLoop`, `RunLoopInput`, `RunLoopResult` |
| RunEvent bus | `createRunEventBus`, `RunEventBus`, `RunEventListener`, `RunEventOutput` |
| Config | `resolveRunConfig`, `resolveTurnContext` |
| Lifecycle | `withRun`, `withTurn`, `publishMessageLifecycle`, `appendToLog`, `RunAbortError` |
| 消息 log | `createMessageLog`, `MessageLog` |
| LLM 流 | `streamAssistantResponse`, `assistantHasToolCalls`, `extractTextReply` |
| Tool | `executeToolCalls` |

完整列表见 [`src/index.ts`](src/index.ts)。

### testing subpath

| 符号 | 用途 |
|------|------|
| `mockTextStreamFn`, `mockTextAndToolStream`, `mockToolThenTextStream` | 构造 `StreamFn` |
| `noopToolExecutor` | 构造 `ToolExecutor` |
| `identityRunConfig` | 最小 `RunConfig` |
| `createRunEventBus` | 测试内 bus |

## 类型 import

本包**只**消费 `@moontide/run-protocol` 域类型（`RunConfig`, `RunEvent`, `AgentMessage`, ports）。不 import `@moontide/llm/protocol` 或 `@moontide/session`；LLM wire 与 Session 在 Harness 的 `convertToLlm` / commit port 边界转换。

全表：[`docs/spec/type-imports.md`](../../docs/spec/type-imports.md)。

## 最小用法

```ts
import { runLoop, createRunEventBus } from "@moontide/agent-core";
import {
  mockTextStreamFn,
  noopToolExecutor,
  identityRunConfig,
} from "@moontide/agent-core/testing";

const result = await runLoop({
  prompt: "hello",
  runConfig: identityRunConfig(),
  streamFn: mockTextStreamFn("hi"),
  toolExecutor: noopToolExecutor(),
  bus: createRunEventBus(),
});
```

生产路径应通过 `@moontide/agent` 的 `AgentRun` / `runAgent`，而非在 CLI 直接调 core。

## 相关文档与验收

| 文档 / 测试 | 内容 |
|-------------|------|
| [`docs/spec/agent-core.md`](../../docs/spec/agent-core.md) | 设计哲学、lifecycle、RunConfig 槽 |
| [`agent-core-roadmap.md`](../../docs/notes/runtime/agent-core-roadmap.md) | 分期与 M 里程碑 |
| [`tests/conformance/agent-runtime.test.ts`](../../tests/conformance/agent-runtime.test.ts) | runtime 契约 |
| [`packages/agent-core/tests/loop-golden.test.ts`](tests/loop-golden.test.ts) | loop golden |
| [`packages/agent-core/tests/lifecycle-invariants.test.ts`](tests/lifecycle-invariants.test.ts) | lifecycle 配对 |
