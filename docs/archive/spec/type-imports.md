# 类型 import 指南

> **权威：** 本文是 MoonTide **契约 type import 的当前 Spec**（按域包边界，非 `@moontide/schema`）。
> **参考：** OpenCode 式 canonical schema 层见 [`schema-package-plan.md`](../notes/runtime/schema-package-plan.md) — **deferred / no-go**（2026-08）；Revisit 条件见该文 §0.2。

各包类型按**域边界**划分，不存在全仓库统一的 `@moontide/types`。本文说明：**从哪个包 import 什么**、**何时用 `@moontide/shared`**、**层间如何转换**。

相关：[`monorepo-packages.md`](../notes/runtime/monorepo-packages.md) · [`context-composer.md`](context-composer.md) §1.4 · [`AGENTS.md`](../../AGENTS.md) §7.2

---

## 1. 决策表（按域）

| 你要表达的是… | import 自 | 典型符号 |
|---------------|-----------|----------|
| Run 内时序、transcript、Effect port | `@moontide/run-protocol` | `RunEvent`, `RunConfig`, `AgentMessage`, `StreamFn`, `ToolExecutor`, `PROTOCOL_VERSION` |
| 一次 LLM HTTP/API 调用的 wire 形状 | `@moontide/llm/protocol` | `Message`, `ContentBlock`, `LLMRequest`, `LLMResponse`, `ToolSchema` |
| Model 注册表、context window、vendor id | `@moontide/llm/models` | `ModelProfile`, `MODEL_REGISTRY`, `resolveModelProfile` |
| LLM 路由与执行（非纯类型） | `@moontide/llm` | `resolveRoute`, `runLLM`, `LLMProvider` |
| Session Item Log、持久化事实源 | `@moontide/session` | `SessionItem`, `SessionMessage`, `messagesFromItems` |
| Context compile 产物 | `@moontide/context-composer` | `composeContext`, `ContextManifest`, compose 选项类型 |
| Tool manifest、permission | `@moontide/tools` | `ToolSpec`, `ToolDefinition`, `checkPermission` |
| Sidecar 插件契约 | `@moontide/plugins-sdk` | `defineSidecarPlugin`, sidecar hook/tool 类型 |
| Agent Event 持久化 | `@moontide/log` | `AgentEvent`, `JsonlWriter`, event hub 类型 |
| Harness run 入口、bootstrap | `@moontide/agent` | `AgentSession`, `runAgent`, `getWorkdir` |
| 终端 REPL、stderr 渲染 | `@moontide/agent-cli` | `createCliEventOutputs`（**业务层不应**为类型依赖 CLI） |

**不要**让 `session`、`context-composer`、`llm` 依赖 `@moontide/run-protocol`；**不要**让 `run-protocol` / `agent-core` 依赖 `session` 或 `composer`。

---

## 2. `@moontide/shared` 用在哪

`shared` 是**原语层**：跨域、无业务语义、变更理由与 Run/Session/LLM 域无关的类型与工具。

| 子路径 | 内容 | 谁该用 |
|--------|------|--------|
| `@moontide/shared/constants/*` |  env 键名、默认值、存储路径常量 | 任意包；读 `MOONTIDE_*` 配置 |
| `@moontide/shared/errors/*` | `ErrorCode`（工具/权限/infra）、`MoonTideError`、`toMessage` | tool handler、CLI fatal、permission |
| `@moontide/shared/protocol/*` | **跨层 protocol 原语**（当前：`ToolArgumentStatus`） | 定义新 LLM/run 共用枚举时在此添加；域包 re-export |
| `@moontide/shared/utils/*` | path、fs 封装、glob、text | 业务层委托 shared，不直接 `node:fs` |
| `@moontide/shared/storage/*` | NDJSON/list 约定（非 Session 域模型） | 需要 MoonTide 路径约定的存储 helper |

### 什么该放进 shared/protocol

同时满足才抽：

1. **至少两个域包**需要同一字面量/枚举（如 LLM `ContentBlock` 与 run `AgentMessage` 共用 tool 参数解析状态）。
2. **无 Run/Session/LLM 域语义** — 不是 `RunEvent` 成员，不是 `SessionItem` kind，不是 `LLMRequest` 字段组合。
3. **稳定且极小** — 单个 union 或常量；不是整份 message 模型。

不满足则留在域包，层间用 **adapter 函数**转换（见 §3）。

### 什么不该放进 shared

| 反例 | 应留位置 |
|------|----------|
| `AgentMessage` / `RunConfig` | `@moontide/run-protocol` |
| `Message` / `LLMRequest` | `@moontide/llm/protocol` |
| `SessionItem` | `@moontide/session` |
| Run 级 `ErrorCode`（`user_abort`, `context_exhausted`） | `@moontide/run-protocol`（与 shared 工具链 `ErrorCode` **不同域**） |
| 工具/权限 `ErrorCode` | `@moontide/shared/errors` |

---

## 3. 层间转换（不用统一 type）

域模型 deliberately 分离；边界处用命名清晰的 pure 函数：

```text
Session Item  ──messagesFromItems──▶  SessionMessage
                                         │
                                   composeContext
                                         ▼
                              Message[] (@moontide/llm/protocol)
                                         │
                          RunConfig.convertToLlm (agent-core)
                                         ▼
                              AgentMessage / LlmMessage (run-protocol)
                                         │
                                       runLoop
```

Harness 内示例：[`message-map.ts`](../../packages/agent/src/agent/harness/message-map.ts)（`AssistantMessage` ↔ `ContentBlock` ↔ `Message`）。

---

## 4. 按调用方 quick reference

| 调用方 | 主要类型来源 |
|--------|--------------|
| `@moontide/agent-core` | `@moontide/run-protocol` |
| `@moontide/agent` | 上表全部（通过 harness 装配）；run 栈用 run-protocol，compile 用 llm+session+composer |
| `@moontide/agent-cli` | `@moontide/agent` + `@moontide/run-protocol`（仅 `RunEvent` 观测）；**不** direct import session/composer |
| `@moontide/context-composer` | `@moontide/llm/protocol`, `@moontide/llm/models`, `@moontide/session`（ports） |
| `@moontide/evals` | `@moontide/agent`, `@moontide/llm`；**不** `@moontide/agent-cli` |
| `@moontide/tools` | `@moontide/llm/protocol`（`ToolSchema`）, `@moontide/shared/errors` |
| 测试 mock | `@moontide/run-protocol`（StreamFn/ToolExecutor）, `@moontide/agent/testing` |

---

## 5. 跨层 primitive 去重（当前）

| 符号 | 唯一定义 | 域包 re-export |
|------|----------|----------------|
| `ToolArgumentStatus` | `@moontide/shared/protocol/tool` | `@moontide/llm/protocol`, `@moontide/run-protocol` |

新增跨层 primitive 时：先加 `shared/protocol`，再在各域包 re-export；[`architecture-boundaries.test.ts`](../../tests/conformance/architecture-boundaries.test.ts) 扫描重复定义。
