
> **状态：** backlog · **notes**（非 Spec）  
> **Spec：** [`llm-provider.md`](../spec/llm-provider.md) §13  
> **关联：** [Feature Eval PR 计划（agent-eval-roadmap §6）](agent-eval-roadmap.md) · [`packages/evals/`](../packages/evals/) · [TODO.md](../../TODO.md)

本文记录 **API 适配层** 中刻意移出 [Feature Eval PR 流水线](../../.cursor/plans/eval_pr_pipeline_be0851ee.plan.md) 的工作项。eval 计划 Phase 3 仅做 judge 路径整理与 `adapterFamily` 分发；下列条目在 eval 流水线完成后或并行按 §13 分期推进。

---

## 1. Agent tool loop 切 OpenAI Chat

**状态：** **done**（Phase 4）。DeepSeek preset agent 默认走 `openai-chat-completions`（`https://api.deepseek.com/chat/completions`）。Judge `json_object` 同族。

**历史：** 曾走 `anthropic-messages`（`api.deepseek.com/anthropic`）与 deprecated `deepseek-openai-chat.ts` re-export；已删除 Anthropic SDK 与 `anthropic` preset。

**验收（已通过）：**

- tool loop smoke（grep、read、单轮 tool call）
- `pnpm run check` 全绿

**Spec 分期：** [`llm-provider.md`](../spec/llm-provider.md) §13-D

---

## 2. 通用 tool_calls normalize

**状态：** **done**（Phase 2–4）。`packages/llm/src/normalize/` 含 OpenAI Chat round-trip；oracle 测试覆盖。

---

## 3. count_tokens preflight

**状态：** **done**（Phase 5）。DeepSeek `count_tokens` 经 `POST /anthropic/v1/messages/count_tokens`（fetch）；capability 声明在 `openai-chat-completions`；`exactTokenCount` 经 `lookupCapabilityStatus` gate。

**验收：** `llm-count-tokens.contract.test.ts`；live preflight 需 `DEEPSEEK_API_KEY` + `MOONTIDE_LIVE_LLM=1`。

---

## 4. `custom` Preset

**目标：** 用户自建 OpenAI 形或 Anthropic 形中转：`MOONTIDE_CUSTOM_BASE_URL` + `MOONTIDE_CUSTOM_ADAPTER` + `CUSTOM_API_KEY`。

**验收：** 文档 + smoke；复用已有 adapter，不新增协议族。

**Spec 分期：** §3.3、§13-F

---

## 5. Responses API adapter

**状态：** **pending**（Phase 6）。capability 表已声明；`adapterChat` 对 `openai-responses` 返回 `adapter_not_implemented`。

**目标：** OpenAI Responses API 兼容路径（fetch），base URL `https://api.deepseek.com/responses`。

**约束（厂商，2026-08）：** 暂主要支持 `deepseek-v4-flash`；v4-pro 支持待厂商开放。

**用途：** Codex 兼容、`max_output_tokens` 单次输出上限；**非** eval judge 必需（judge 已用 Chat Completions `response_format: json_object`）。

**验收：** flash smoke；eval 不依赖。

**Spec 分期：** §6.1「按需」

---

## 6. 建议实施顺序

1. ~~`normalize/` tool 块互转~~（done）
2. ~~`openai-chat-completions.ts`~~（done）
3. ~~DeepSeek count_tokens~~（done）
4. `openai-responses.ts` fetch adapter（Phase 6）
5. `custom` preset（§13-F）

---

## 7. 变更记录

| 日期 | 说明 |
|------|------|
| 2026-08 | Phase 5 count_tokens；capability gate；Responses Phase 6 pending |
| 2026-08 | 初稿：自 Feature Eval PR 计划移出；对齐 llm-provider §13 |
