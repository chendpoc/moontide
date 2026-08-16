> **已归档：** TypeScript 时代的 LLM input 对表，仅供追溯。当前 Rust 请求组装见 [`model_input/DESIGN.md`](../../../crates/agent-core/src/model_input/DESIGN.md)。archive 内部链接可能已失效。

> 说明「成熟 agent 一次 LLM 请求应包含什么」，以及 **MoonTide 当前实现** 落在哪、缺什么。
> 行业背景见 [`context-analysis.md`](../notes/context/context-analysis.md)；Provider / API 适配层见 [`llm-provider.md`](llm-provider.md)；Session 中间态与 **Context Composer** 见 [`context-composer.md`](context-composer.md)（目标产出 **`LLMRequest`**）。
> 本文只做 **API 对表 + 代码落点**，不涉及代码实现计划。

---

## 1. API 顶层：实际只有三个参数

MoonTide 的请求协议与 API 映射见 [`packages/llm/src/protocol/types.ts`](../../packages/llm/src/protocol/types.ts) 和 [`packages/llm/src/adapters/`](../../packages/llm/src/adapters/)：

```typescript
messages.create({ model, system, messages, tools, max_tokens })
```

| API 参数 | 含义 | MoonTide 谁组装 | 现状 |
|----------|------|----------------|------|
| `system` | 静态/半静态指令 | [`composeContext`](../../packages/context-composer/src/compose.ts) → `buildSystemFromInstructionState` | 有，每 turn 由 Instruction State 组装 |
| `tools` | 工具名 + description + schema | [`src/tools/index.ts`](../../packages/tools/src/index.ts) → `getToolDefinitions()` | 有，按 config 动态注册 |
| `messages` | 对话时间线 | REPL / `runAgent` 创建数组，`loop.ts` append | 有，**单一可变数组** |
| `max_tokens` | 单次输出上限 | [`src/constants/llm.ts`](../../packages/shared/src/constants/llm.ts) `DEFAULT_MAX_TOKENS=8000` | 有，与 context 预算分开 |

**常见误解纠正：**

| 说法 | 实际落点 |
|------|----------|
| personal memory prompt | 应 **拼进 `system`**（或每轮从文件读出再拼），不是独立 API 字段 |
| user input | `messages` 里 **最新的 user 条目**，不是第 4 个参数 |
| tool output | `messages` 里 `role: user` 的 **`tool_result` block**，属于 session history |

---

## 2. `system` 里通常有什么

| 内容块 | 成熟做法 | MoonTide | 代码 / 文件 | 备注 |
|--------|----------|---------|-------------|------|
| 身份 / 角色 | system 首段 | **有** | [`src/agent/prompt.ts`](../../packages/agent/src/agent/prompt.ts) | "You are MoonTide…" |
| 工作区路径 | cwd / workdir | **有** | `prompt.ts` → `getWorkdir()` | 动态注入 |
| 全局 tool 选用策略 | prefer read_file over bash 等 | **有** | `prompt.ts` L8–11 | 与部分 tool description 重复 |
| Extension 使用说明 | code_repl runtime、templates | **有（混在 system）** | `prompt.ts` L14–23 | code_repl schema 里也有长 description |
| 项目规则 | `AGENTS.md` / `CLAUDE.md` / `.moontide/rules/*.md` | **有** | [`instruction-state/load.ts`](../../packages/agent/src/instruction-state/load.ts) | 经 `resolveInstructionState` → compose |
| 用户偏好 / 长期记忆 | `~/.moontide/` 或 MEMORY.md，每轮 re-inject | **无** | — | `InstructionState.userMemory` 接口预留 |
| 权限 / 审批提示 | "bash 可能需用户确认" | **无** | permission 在 [`runTool.ts`](../../packages/agent/src/agent/pipeline/runTool.ts) 执行层 | 模型不可见 |
| 压缩摘要 | 通常放 **messages**，不是 system | — | `/compact summary` 进 messages | 见 §4 |

**结论：** `system` = `buildDefaultBasePrompt` + project rules（[`instruction-state/`](../../packages/agent/src/instruction-state/)）；无 personal memory 文件源。

---

## 3. `tools[]` 里通常有什么

| 内容块 | 成熟做法 | MoonTide | 代码 / 文件 | 备注 |
|--------|----------|---------|-------------|------|
| Tool name | API schema | **有** | 各 `ToolDefinition.schema.name` | |
| Tool description | 每个 tool 一段 | **有** | [`tools/builtins/*-tools.ts`](../../packages/tools/src/builtins/) 等 | grep / code_repl 较详细 |
| input_schema | JSON Schema | **有** | 同上 | |
| 按配置启用/禁用 | 未启用不传 API | **部分** | `http_fetch` / `code_repl` / `deep_research` 条件注册 | [`register-defaults.ts`](../../packages/agent/src/tools/register-defaults.ts) |
| Lazy / deferred 加载 | 先给名字，详情按需读 | **无** | 每 turn 全量 `getToolDefinitions()` | |
| 稳定排序（cache） | 固定 tool 顺序 | **部分** | `resolveToolDefinitions()` 按 `name` 字典序 | 未显式做 cache breakpoint |
| Built-in plugin prompt 进 tool desc | code_repl 动态拼 runtime/template | **有** | [`plugins/builtin/code-repl/index.ts`](../../packages/agent/src/plugins/builtin/code-repl/index.ts) | 与 system 重复列举 templates |

**结论：** Tool 层基本齐全；缺 lazy load、与 system 的去重/单一真相源。

---

## 4. `messages[]` 里通常有什么

| 内容块 | 成熟做法 | MoonTide | 代码 / 文件 | 备注 |
|--------|----------|---------|-------------|------|
| 用户输入（首轮） | `role: user` 文本 | **有** | [`runAgent`](../../packages/agent/src/agent/loop.ts) / REPL | |
| 用户输入（后续轮） | messages 末尾 append | **有** | `continueReplAgent` push | 不是独立 API 字段 |
| Assistant 文本 | `role: assistant` text | **有** | loop push `response.content` | |
| Assistant tool 调用 | `tool_use` blocks | **有** | 模型返回，原样 push | |
| Tool 执行结果 | `role: user` + `tool_result` | **有** | [`runToolUses`](../../packages/agent/src/agent/pipeline/runTool.ts) | 大输出 spill → summary |
| Thinking（若模型支持） | assistant thinking block | **有（若 API 返回）** | compose `applyPrune` 可 strip | [`apply-prune.ts`](../../packages/context-composer/src/compaction/apply-prune.ts) |
| 旧对话 LLM 摘要 | synthetic user message | **有** | `/compact summary` → **CompactionSave** | compose `applySummary` 注入摘要 |
| 大 tool 输出外置 + 短引用 | artifact 文件 + `ToolResultSummary` | **有** | Artifact spill + `formatToolSummary` | 默认 8KB 阈值 |
| 完整归档 vs 发给模型 | Session Item Log 与 LLM input 分离 | **有** | SessionContext + `composeContext` | 见 [`context-composer.md`](context-composer.md) |
| 多模态（图片等） | message content blocks | **无** | 仅 string / tool blocks | |

### 当前数据流

```mermaid
flowchart LR
  REPL["REPL / AgentSession"] --> SC["SessionContext.messages"]
  SC --> Compose["composeContext"]
  Compose --> RunLLM["runLLM chat"]
  RunLLM --> Append["append assistant / tool"]
  Append --> SC
  SC --> SIL["Session Item Log jsonl"]
```

---

## 5. 你列的五项 → 正确落点

| # | 你的说法 | API 落点 | MoonTide 现状 |
|---|----------|----------|--------------|
| 1 | system prompt | `system` | **有** — `prompt.ts` |
| 2 | tool description | `tools[].description` + `input_schema` | **有** — 各 tool 注册 |
| 3 | personal memory prompt | 并入 `system`（每轮从文件拼） | **无** |
| 4 | session history | `SessionContext` → compose → `messages[]` | **有** — append-only 内存 + Item Log |
| 5 | user input | `messages` 最新 user 条目 | **有** — 不是独立参数 |

---

## 6. 相关但不在「一次 LLM input」里

| 项 | 作用 | MoonTide |
|----|------|---------|
| Context 用量估算 | 决定是否 compact | **有** — [`plugins/builtin/context/metrics.ts`](../../packages/agent/src/plugins/builtin/context/metrics.ts) + context sidecar hook |
| Event JSONL | 观测 / UI tail | **有** — [`log/event-hub`](../../packages/log/src/event-hub.ts) fan-out；与 LLM messages **分离** |
| `runtime-status.ts` | inspect_context / statusline | **有** — 仅 manifest/report，不镜像 messages |
| Model context limit | 预算阈值 | **有但可能过时** — [`constants/llm.ts`](../../packages/shared/src/constants/llm.ts) 128K（DeepSeek 官方 1M） |
| Provider / Model 选型 | 谁发 HTTP、用哪个 model | **未分层** — 目标见 [`llm-provider.md`](llm-provider.md)（API 适配方案 A：`LLMProvider` + adapter） |
| adapter / normalize | SDK 与协议翻译 | **未分层** — 目标见 [`llm-provider.md` §5–§8](llm-provider.md#5-api-适配选型方案-a) |

---

## 7. 缺口优先级（对照 context-window 设计）

| 优先级 | 缺口 | 今天表现 | 建议方向（MoonTide 演进，未实现） |
|--------|------|----------|----------------------------------|
| P0 | messages 一物两用 | ~~loop 原地 splice~~ | **done** — `composeContext` 编译 |
| P0 | 无 project / memory 注入 | ~~仅 `prompt.ts`~~ | **done** — project rules 经 instruction-state；userMemory 仍 pending |
| P1 | tool 输出全量进 messages | ~~大 read 全文~~ | **done** — Artifact spill + summary |
| P1 | `sessions.ts` 镜像 messages | ~~statusline 读引用~~ | **done** — `runtime-status.ts` |
| P1 | instruction 可被 compact 间接丢 | summary 只摘要对话 | **done** — Instruction State 每轮 `resolveInstructionState` 重建 |
| P2 | Compaction 与恢复未分层 | — | **done** — CompactionSave / Checkpoint / `/compact` |
| P2 | context limit 128K | 与 DeepSeek 1M 不一致 | **model 注册表** + `ModelProfile`，见 [`llm-provider.md`](llm-provider.md) |
| P2 | Provider / Model 绑 Anthropic SDK | 仅 DeepSeek compat | API 适配方案 A：Preset + `LLMProvider` + 4 协议族 adapter，见 [`llm-provider.md`](llm-provider.md) |

---

## 8. 一句话总结

**MoonTide 今天已覆盖：** `system`（Instruction State：`prompt.ts` + `AGENTS.md` / rules）+ `tools` + `messages`（经 **`composeContext`** 编译）；大 tool 输出 **Artifact spill**；**CompactionSave** summary；**Checkpoint** resume；**runtime-status** 观测缓存。

**尚未覆盖：** personal memory 文件源、`read_artifact` tool；Provider **D–I**（多 adapter、OpenRouter、Model Router）— 见 [`llm-provider.md`](llm-provider.md) §13 · [`context-window-roadmap.md`](../notes/context/context-window-roadmap.md) **#5 backlog**。

---

## 相关文档

- [`context-window-roadmap.md`](../notes/context/context-window-roadmap.md) — 当前六件事执行计划
- [`context-composer.md`](context-composer.md) — Session Item Log、Context Composer、Compaction / Checkpoint
- [`context-backlog.md`](../notes/context/context-backlog.md) — Context 演进特性（分账、IR、实验与 Deferred）
- [`llm-provider.md`](llm-provider.md) — API 适配方案 A、Provider Preset、`LLMRequest`、`ModelProfile`
- [`context-analysis.md`](../notes/context/context-analysis.md) — 行业 SOTA 与产品对比
- [`vision.md`](../product/vision.md) — 产品名 MoonTide；保留代号与未来方向
- [`agent-events.md`](agent-events.md) — 观测侧 JSONL（与 LLM input 分离）
