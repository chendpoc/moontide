# 开发进度

> 每个模块完成设计 / 实现 / 测试后，勾选对应状态并更新「当前目标」。
> 图例：☐ 未开始 · ◐ 进行中 · ☑ 完成

| # | 模块 | 层 | 依赖 | 设计文档 | 实现 | 测试 | 备注 |
|---|---|---|---|---|---|---|---|
| 1 | `llm` | 契约 | 无 | ☑ | ☑ | ☑ | R1–R4 完成；stacked PR #1–#4 |
| 2 | `session` | 契约 | llm 类型 | ◐ | ☐ | ☐ | item log 唯一写者；设计 draft 落盘，待定稿 |
| 3 | `tools` | 契约 | 无 | ☐ | ☐ | ☐ | ToolSpec + 验收网关 |
| 4 | `permission` | 契约 | 无 | ☐ | ☐ | ☐ | 授权策略 |
| 5 | `event` | 契约 | 无 | ☐ | ☐ | ☐ | RunEvent + bus + bridge |
| 6 | `prompt` | 装配 | tools | ☐ | ☐ | ☐ | compile 唯一出口 |
| 7 | `context` | 装配 | session | ☐ | ☐ | ☐ | materialize + compaction |
| 8 | `loop` | 编排 | 1–7 全部 | ☐ | ☐ | ☐ | turn 状态机 |
| 9 | `scheduler` | 后置 | llm + tools | ☐ | ☐ | ☐ | 分诊 + fan-out + delegate |

## 当前目标

- 模块 1 `llm`：**完成**，已进 `main`（`0328327`）。
- 模块 2 `session`：**设计 draft 落盘，待定稿**（分支 `feat/agent-core-session/base`）。

## 变更记录

- 2026-08-15：`session` 设计文档 draft 落盘（4 类 SessionItem + §8 A–G 开放问题，待定稿）；归档 4 份 TS 时代文档 + 更新 doc map。
- 2026-08-15：`llm` 进 `main`；删除初版 draft crate；开始 `session` 架构对齐。
- 2026-08-14：`llm` 实现完成（R1 契约 · R2 normalize · R3 adapter · R4 不变量单测；38 tests）。
- 2026-08-14：父 skill 重命名为 `moontide-kernel-plan`（原 moontide-roadmap-v1-dev-plan）。
- 2026-08-14：`llm` 架构对齐完成，设计文档落盘（MoonTide protocol + AdapterFamily + normalize 混合结构；默认 DeepSeek × OpenAiChatCompletions）。
- 2026-08-14：推进模板改为「先架构对齐、用户确认后再落文档/实现」；开始 `llm` 对齐。
- 2026-08-14：skill 创建，9 模块全部未开始。
