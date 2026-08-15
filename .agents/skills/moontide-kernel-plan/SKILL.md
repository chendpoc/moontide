---
name: moontide-kernel-plan
description: MoonTide 内核 Rust 化路线图与进度（9 模块依赖顺序、设计文档索引、架构对齐门禁）。Use when 推进 moontide-agent-core 内核开发、确认模块进度或设计决策。
---

# MoonTide v1 开发路线图

这是一次长任务：按依赖顺序逐模块把内核从草稿重建为 Rust 实现。每次启动本 skill 后，**先读进度和上下文，再开始动手**，避免重复设计或遗漏已定决策。

## 每次启动必做

1. 读 [PROGRESS.md](PROGRESS.md) —— 各模块当前状态（未开始 / 进行中 / 完成）、当前推进目标。
2. 读 [CONTEXT.md](CONTEXT.md) —— 历次讨论的设计文档索引 + 关键设计决策速查。

读完两份后，确定本次要做哪个模块，再进入下面的推进模板。

## 开发纪律（铁律）

- 9 个模块**按依赖顺序逐模块推进**，不跳跃、不并行。
- **只有两个 trait**：`LLMProvider`、`ToolExecutor`；其余模块用具体类型 + 策略模式，不上 trait。
- `session` 是 item log **唯一写者**；`prompt.compile()` 和 `context.materialize()` 是**唯一出口**。
- **不 import、不复用** `crates/` 下旧 draft 代码（`moontide-agent` / `composer` / `llm` / `session` / `tools` / `observability` / `protocol` 等，只作设计参考）。
- 每个模块走「架构对齐 → 落文档 → 实现 → 单测 → 更新 PROGRESS」循环，不先写完 9 份再写代码。

## 依赖图（推进顺序）

```
契约层  1. llm → 2. session → 3. tools → 4. permission → 5. event
装配层  6. prompt → 7. context
编排层  8. loop
后置    9. scheduler
```

完整 checklist 与接口边界见 [`crates/moontide-agent-core/README.md`](../../../crates/moontide-agent-core/README.md)。

## 推进模板（硬门禁：先架构对齐）

用户扮演**架构师**：掌握到 **trait / 结构体 / enum / 公开函数签名** 这一层；**不**讨论函数体、胶水代码、序列化细节、测试样板。

每个模块严格按四段推进，**禁止跳过第 1 段直接写代码**：

### 1. 架构对齐（对话，未确认前禁止落盘实现）

向用户提出本模块的**接口草案**，粒度固定为：

| 要给出的 | 不要给出的 |
|---|---|
| 模块职责一句话 | 函数内部算法 / 控制流 |
| 公开类型清单（struct / enum / trait）及字段或变体 | 私有 helper、adapter 内部类型 |
| 公开方法 / 自由函数的**完整签名**（参数、返回值、错误类型） | 胶水代码、builder 样板、serde 注解争论 |
| 不变量与非法状态 | 单测用例列表（可后置） |
| 与上下游模块的 import 边界（谁依赖谁） | 具体 HTTP / IPC 实现 |

对齐方式：

1. Agent 给出草案（可用 Rust 伪代码签名）。
2. **停下来等用户确认或修订**——逐项改到用户满意。
3. 有分歧时先辩清楚再往下；用户未明确「可以落文档 / 可以写代码」之前，**不写实现、不建源码文件**。
4. 确认结果写入对话结论；若决策可复用，补一条到 [CONTEXT.md](CONTEXT.md)「关键设计决策速查」。

`PROGRESS.md` 在本阶段将模块标为 `◐ 设计对齐中`。

### 2. 设计文档（确认后才写）

用户确认接口后，写入 `crates/moontide-agent-core/src/{mod}/README.md`，含：

- 职责一句话
- 关键类型 / 接口（与对齐稿一致的 Rust 伪代码签名）
- 不变量
- 决策记录（为什么这么设计，1–3 条）
- 边界情况（仍停在接口层，不写实现步骤）

**粒度对齐复杂度**：permission / event 半页即可；loop / context / session 需状态机图 + 完整决策记录。

`PROGRESS.md`：设计文档勾选完成。

### 3. 实现 + 单测（子 skill：分批 review · commit）

设计文档 ☑ 后，**必须**走子 skill [batch-implement](batch-implement/SKILL.md)：

1. 从 README 生成 `src/{mod}/TASKS.md`（可参考子 skill 内 `llm-TASKS.example.md`）
2. 与用户确认本批 TASK（默认 1 个/批）
3. 实现 + `just check` → **停等用户 git diff review**
4. 用户说 **commit** 后再提交；勾选 TASK → 下一批
5. 全部 TASK ☑ 后进入 §4 收尾

实现阶段若发现必须改公开签名，**先回到第 1 段与用户对齐**，禁止静默改契约。

### 4. 收尾

更新 [PROGRESS.md](PROGRESS.md)：勾选实现 / 测试，更新「当前目标」指向下一模块。

## 完成后

进入下一模块时，再次从「架构对齐」开始，不假设用户还记得上一模块细节——用 PROGRESS + CONTEXT 冷启动。
