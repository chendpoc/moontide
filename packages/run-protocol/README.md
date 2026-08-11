# @moontide/run-protocol

本包导出 **RunEvent protocol** 的类型：`RunEvent`、`RunConfig`、Effect port（`StreamFn`、`ToolExecutor`）与 `AgentMessage` transcript。术语见 [`AGENTS.md`](../../AGENTS.md) §7.2 · 开发计划 [`agent-core-roadmap.md`](../../docs/notes/runtime/agent-core-roadmap.md)。

## 职责

- 定义 run 内 **语义事件** union（`RunEvent`）与 **run 前冻结** 的策略对象（`RunConfig`）
- 定义 turn 编译结果（`TurnCompileResult`）与 LLM 侧消息形状（`LlmMessage`）
- 定义 **Effect port** 注入边界：`StreamFn`（流式 assistant）、`ToolExecutor`（tool 执行）
- 提供 `PROTOCOL_VERSION`，供 `@moontide/agent-core`、Harness、`@moontide/log` 对齐协议版本

本包 **只有类型与常量**，无运行时 IO、无算法实现。

## 不做什么（硬边界）

| 禁止 | 说明 |
|------|------|
| Session / Item Log | 不在此包；见 `@moontide/session` |
| Context compile | 不在此包；见 `@moontide/context-composer` |
| LLM **API 适配层** | 不在此包；见 `@moontide/llm` |
| Harness / REPL | 不在此包；见 `@moontide/agent` |

## 谁应该用

| 调用方 | 典型用途 |
|--------|----------|
| `@moontide/agent-core` | `runLoop`、RunEvent bus、resolveRunConfig |
| `@moontide/log` | RunEvent 订阅与 Agent Event derive 类型 |
| `@moontide/agent` | 经 core 间接消费；Harness 扩展 RunConfig 决策回调 |
| 测试 | mock `StreamFn` / `ToolExecutor`、构造 `RunConfig` |

**不应**被 `@moontide/agent-cli` 直接 import（CLI 经 `@moontide/agent` → `@moontide/agent-core`）。

## 对外 API

### package.json exports

| Subpath | 说明 |
|---------|------|
| `@moontide/run-protocol` | 根 re-export（同 `./protocol`） |
| `@moontide/run-protocol/protocol` | 完整 protocol 模块 |

### 稳定符号（根 export）

| 类别 | 符号 |
|------|------|
| 版本 | `PROTOCOL_VERSION`, `ProtocolVersion` |
| 消息 | `AgentMessage`, `UserMessage`, `AssistantMessage`, `ToolResultMessage`, `isAssistantMessage`, … |
| 结果 | `Outcome`, `ErrorCode`, `ErrorInfo` |
| Run | `RunEvent`, `RunConfig`, `RunConfigSource`, `TurnCompileResult`, `LlmMessage` |
| RunConfig 回调参数 | `CompileTurnContextParams`, `BeforeToolCallParams`, `AfterToolCallParams`, `ShouldStopAfterTurnParams`, … |
| Effect port | `StreamFn`, `ToolExecutor`, `StreamAssistantEvent`, `LlmContext`, `AgentTool` |
| 流式 | `StreamDelta` |

完整列表见 [`src/protocol/index.ts`](src/protocol/index.ts)。

## 最小用法

```ts
import type { RunConfig, StreamFn, ToolExecutor } from "@moontide/run-protocol";
import { PROTOCOL_VERSION } from "@moontide/run-protocol";

const config: RunConfig = {
  convertToLlm: (messages) => /* … */,
  beforeToolCall: async () => ({ decision: "allow" }),
};

// 测试替身：实现 StreamFn / ToolExecutor 注入 agent-core runLoop
const streamFn: StreamFn = async function* () { /* … */ };
```

### Protocol 版本 bump

- 修改 `RunEvent` union、`RunConfig` 槽签名或破坏性字段语义 → **递增** `PROTOCOL_VERSION`（见 [`src/protocol/version.ts`](src/protocol/version.ts)）
- 仅加可选字段 / 新事件成员 → 文档约定「只增不改」；是否 bump 由 PR 评审决定

## 相关文档与验收

| 文档 | 内容 |
|------|------|
| [`docs/spec/agent-core.md`](../../docs/spec/agent-core.md) | Temporal core 如何使用 RunConfig / RunEvent |
| [`AGENTS.md`](../../AGENTS.md) §7.2 | RunEvent bus · resolveRunConfig · resolveTurnContext |
| [`monorepo-packages.md`](../../docs/notes/runtime/monorepo-packages.md) | 全仓库包索引 |
