# Deep Task Mode（`deep:` prompt gate）

> **Doc Map：** [`docs/README.md`](../README.md) · 用词规范见 [`agent.md`](../../agent.md)

Deep Task Mode 是 REPL 内的一种**任务级工作记忆**模式：用户以 `deep:` 前缀发起 prompt，Agent 获得 `work_mem` tool，并在 compose 时注入 **Working Set snapshot**（非 prunable）。

**优化设计（草案）：** 当前实现与用户期望存在差距（主 run 未走 `composeForSession`、无强制 protocol），见 [`deep-mode-redesign.md`](deep-mode-redesign.md)。

**刻意不提供** `/deep` slash 命令；入口只有 prompt 级 `deep:` gate。

## 触发与生命周期

| 事件 | 行为 |
|------|------|
| 用户输入以 `deep:` 开头（大小写不敏感） | 剥前缀 → 开启 Deep Task Mode → 新建 `wm_<8hex>` 任务 → **机械 seed outline** → `ToolRegistry.refresh()` 注册 `work_mem` |
| 同 session 再次 `deep:` | 新建另一个 `workMemId`（每次 deep prompt 一条独立 jsonl） |
| `/reset` 或新 session | `resetDeepModeOnNewSession()` → 关闭 deep mode、清空 active map、`refresh()` 移除 `work_mem` |
| 普通 prompt（无 `deep:`） | 不进入 deep mode；无 token budget 阶梯 |

实现入口：

- Gate：[`src/agent/deep-mode.ts`](../../src/agent/deep-mode.ts) · REPL 调用 [`src/cli/repl/run.ts`](../../src/cli/repl/run.ts)
- Tool：`work_mem` → [`src/plugins/builtin/work-mem/`](../../src/plugins/builtin/work-mem/)

## `work_mem` tool

仅在 `isDeepModeEnabled()` 为 true 时出现在 registry（`defineWorkMemTools()` 返回 `null` 否则）。

| action | 作用 |
|--------|------|
| `draft` | 追加结构化草稿条目 |
| `note` | 追加短笔记 |
| `summarize` | 按 pack tier 生成 deterministic pack（无 LLM） |
| `refine` | 压缩/整理已有条目（deterministic） |

持久化路径：

```
.moontide/sessions/<sessionId>/work-mem/<workMemId>.jsonl
```

## Working Set 与 budget escalation

Compose 路径（[`compose-for-turn.ts`](../../src/agent/compose-for-turn.ts) → [`working-set-compose.ts`](../../src/agent/working-set-compose.ts)）在 deep mode 下：

1. 注入 **Deep Task Protocol** system 块（goal · workMemId · 使用节奏）
2. 解析 Working Set snapshot，追加到 **system**（[`working-set.ts`](../../src/context/composer/working-set.ts)），不参与 message prune

详设：[`deep-mode-redesign.md`](deep-mode-redesign.md) · P1 seed + protocol。

**Budget escalation**（harness 管理，无用户 token budget env）：

1. **normal** — 默认 cap 8000 tokens
2. **compact** — 仍超 cap 时 refine 为 compact pack
3. **cap upgrade** — 升至 context window 的 10%
4. **emergency** — 仍超则 emergency pack

**Compaction 联动（§8.3）：** 当 `system + messages + tools` 用量 ≥ compaction threshold 且 snapshot 仍在 **normal** stage，compose 先 **升级至 refined_at_normal**（compact pack），再执行 message prune。

## Agent ↔ plugin 边界

| 层 | 职责 |
|----|------|
| [`agent/deep-mode.ts`](../../src/agent/deep-mode.ts) | REPL 状态 · `deep:` gate · activeWorkMemId |
| [`agent/ports/work-mem.ts`](../../src/agent/ports/work-mem.ts) | 端口：`startDeepTaskRecord` · `resolveWorkingSetSnapshot` |
| [`plugins/builtin/work-mem/register.ts`](../../src/plugins/builtin/work-mem/register.ts) | 注册 store + escalation 实现（bootstrap / register-defaults） |

与 [Context Budget Tiers](context-backlog.md) 计划独立；L1 子账户集成属后续可选 PR。

## 相关测试

- `tests/deep-mode-prompt.test.ts` — gate、无 `/deep` command
- `tests/work-mem.test.ts` — handler、follow-up 写 active jsonl
- `tests/work-mem-escalation.test.ts` — budget escalation 各 stage（normal · refined_at_normal · cap_upgraded · emergency）
- `tests/deep-mode-compose.test.ts` — compose 注入、deep off 跳过、prune 后 snapshot 仍在且 jsonl 未删
- `tests/working-set-compose.test.ts` — §8.3 compaction threshold → budget escalation compact
- `tests/session-paths.test.ts` — `workMemPath`

## 非目标（当前）

- REPL `/deep` 命令
- 用户可配置的 `WORK_MEM_CONTEXT_TOKEN_BUDGET`
- LLM 驱动的 summarize/refine（当前为 deterministic pack）

## 演进

| 文档 | 内容 |
|------|------|
| [`deep-mode-redesign.md`](deep-mode-redesign.md) | **`deep:` 行为优化**：compose 统一、outline seed、protocol、nudge |
