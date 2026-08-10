
> **状态：** backlog · **notes**（非 Spec）  
> **Spec：** [`llm-provider.md`](../spec/llm-provider.md) §13  
> **关联：** [Feature Eval PR 计划（agent-eval-roadmap §6）](agent-eval-roadmap.md) · [`packages/evals/`](../packages/evals/) · [TODO.md](../../TODO.md)

本文记录 **API 适配层** 中刻意移出 [Feature Eval PR 流水线](../../.cursor/plans/eval_pr_pipeline_be0851ee.plan.md) 的工作项。eval 计划 Phase 3 仅做 judge 路径整理与 `adapterFamily` 分发；下列条目在 eval 流水线完成后或并行按 §13 分期推进。

---

## 1. Agent tool loop 切 OpenAI Chat

**现状：** DeepSeek Preset 的 agent 走 `anthropic-messages`（`api.deepseek.com/anthropic`）。Judge 的 `json_object` 走 OpenAI Chat Completions（[`deepseek-openai-chat.ts`](../../packages/llm/src/adapters/deepseek-openai-chat.ts)）。

**目标：** 实现完整 `openai-chat-completions` adapter，使 agent tool loop 可选用 OpenAI Chat 形态访问 DeepSeek（及 Kimi、OpenRouter 等同族 Preset）。

**依赖：**

- [`normalize/`](../../packages/llm/src/normalize/)：`tool_use` / `tool_result` ↔ OpenAI `tool_calls` / `tool` role
- [`getLLMProvider`](../../packages/llm/src/provider.ts) 已按 `adapterFamily` 分发（eval 计划 Phase 3）

**验收：**

- `.env` 切换 adapter 或 Preset 后，tool loop smoke 通过（grep、read、单轮 tool call）
- 行为与 Anthropic Messages 路径 observably 等价（允许 vendor 差异，无 harness 回归）

**Spec 分期：** [`llm-provider.md`](../spec/llm-provider.md) §13-D

**不做为 eval 前置：** L2 eval 测 Harness feature lift，不应与「换 API 形态」绑在同一批 PR。详见 [agent-eval-roadmap.md](agent-eval-roadmap.md) §6。

---

## 2. 通用 tool_calls normalize

**目标：** 跨协议语义转换独立为 `packages/llm/src/normalize/`，供各 adapter 复用。

| 转换 | 说明 |
|------|------|
| MoonTide `ContentBlock` tool_use | → OpenAI assistant `tool_calls` |
| MoonTide tool_result | → OpenAI `tool` role message |
| stream chunk 合并 | 分期；首版可仅 non-stream |

**验收：** 纯函数 oracle 测试；无 SDK import。

**Spec 分期：** §5.4、§13-D

---

## 3. `custom` Preset

**目标：** 用户自建 OpenAI 形或 Anthropic 形中转：`MOONTIDE_CUSTOM_BASE_URL` + `MOONTIDE_CUSTOM_ADAPTER` + `CUSTOM_API_KEY`。

**验收：** 文档 + smoke；复用已有 adapter，不新增协议族。

**Spec 分期：** §3.3、§13-F

---

## 4. Responses API adapter

**目标：** OpenAI Responses API 兼容路径（`client.responses.create`），base URL `https://api.deepseek.com`。

**约束（厂商，2026-08）：** 暂主要支持 `deepseek-v4-flash`；v4-pro 支持待厂商开放。

**用途：** Codex 兼容、`max_output_tokens` 单次输出上限；**非** eval judge 必需（judge 已用 Chat Completions `response_format: json_object`）。

**验收：** flash smoke；eval 不依赖。

**Spec 分期：** §6.1「按需」

---

## 5. 建议实施顺序

1. `normalize/` tool 块互转  
2. `openai-chat-completions.ts`（chat + tools + json_object）  
3. DeepSeek / Kimi Preset 可选 OpenAI Chat agent 路径（与 Anthropic 并存或 env 切换）  
4. `custom` preset（§13-F）  
5. Responses API（有产品需求再做）

---

## 6. 变更记录

| 日期 | 说明 |
|------|------|
| 2026-08 | 初稿：自 Feature Eval PR 计划移出；对齐 llm-provider §13 |
