---
name: moontide-kernel-plan
description: MoonTide 内核 Rust 化路线图与进度（8 模块依赖顺序、设计文档索引、架构对齐门禁）。Use when 推进 agent-core 内核开发、确认模块进度或设计决策。
---

# MoonTide v1 开发路线图

这是一次长任务：按依赖顺序逐模块把内核从草稿重建为 Rust 实现。每次启动本 skill 后，**先读进度和上下文，再开始动手**，避免重复设计或遗漏已定决策。

## 每次启动必做

1. 读 [PROGRESS.md](PROGRESS.md) —— 各模块当前状态（未开始 / 进行中 / 完成）、当前推进目标。
2. 读 [CONTEXT.md](CONTEXT.md) —— 历次讨论的设计文档索引 + 关键设计决策速查。

读完两份后，确定本次要做哪个模块，再进入下面的推进模板。

## 开发纪律（铁律）

- 8 个模块**按依赖顺序逐模块推进**，不跳跃、不并行。
- `LLMProvider`、`ToolExecutor` 是核心能力 trait；其他 trait 只在存在独立实现、动态装配或测试替身的真实边界时引入，不以 trait 数量作为架构指标。
- `session` 是 item log **唯一写者**；`model_input::compile()` 和 `context::materialize()` 是**唯一出口**。
- **不 import、不复用** `crates/` 下旧 draft 代码（`moontide-agent` / `composer` / `llm` / `session` / `tools` / `observability` / `protocol` 等，只作设计参考）。
- 每个模块走「架构对齐 → 落文档 → 实现 → 单测 → 更新 PROGRESS」循环，不先写完 8 份再写代码。
- 每个实现批次同时生成 **Agent Task** 与 **User Parallel Task**：Agent Task 推进代码，User Parallel Task 让用户在等待期间完成与本批直接相关的追踪、review、practice 或决策任务；两者在同一验收点汇合。

### 批次上下文与角色边界

- 每个 Review 批必须建立一个 **Work Packet**，作为 Implementer、Reviewer 和用户之间的最小交接上下文；不要把完整历史对话当作唯一上下文。
- **Implementer** 负责 scoped 实现、测试、文档同步和实现证据；不得静默改架构、公开 API 或批次范围。
- **Reviewer** 负责独立读取 Work Packet、live source、当前 diff 和验证结果，输出 Standards / Spec findings；不得直接替 Implementer 修代码。
- Implementer 与 Reviewer 是逻辑上分离的角色。存在可靠的多 agent 能力时可使用独立 Reviewer；否则也必须以新的 review phase 和独立检查清单执行，不把 Implementer 的自检摘要当作 review 证据。
- Work Packet、Implementation Evidence 和 Review Report 属于开发治理资料，不属于 MoonTide runtime，不进入 `agent-core` / `agent-tools` / `agent` / `cli` 产品边界。
- 只有架构冲突、公开契约变化、范围扩张、破坏性操作或无法解决的 blocker 才暂停请求用户；普通实现细节和 scoped 测试修复继续在批次内完成。

### 协作 agent 名称

- **Tideforge**：`role: implementer`，把 Work Packet 转化为 scoped 代码、测试和文档证据。
- **Tidewatch**：`role: reviewer`，独立检查 Work Packet、live source、diff 和验证结果，输出 Review Report。
- `implementer` / `reviewer` 是 canonical role；`Tideforge` / `Tidewatch` 是协作名称。名称不得改变权限边界，也不代表 MoonTide runtime 内的产品组件。

### 自适应开发模式

计划是当前假设，不是冻结合同。真实开发允许在调研、spike 或实现中发现新约束，并据此调整功能范围、模块设计和架构；但调整必须按影响等级处理，不得静默改变公共契约。

| 模式 | 触发条件 | 允许动作 | 交付物 |
|---|---|---|---|
| **Discovery** | 功能是否值得做、设计证据不足或存在多个可行方向 | 调研、追踪、最小 spike、可丢弃实验 | 假设、证据、开放问题、建议 |
| **Implementation** | 当前契约和范围足够稳定 | scoped 代码、测试、文档和验证 | Implementation Evidence |
| **Replan** | 实现发现设计、边界或产品目标需要变化 | 暂停当前实现，更新决策和 Work Packet | Decision Record、更新后的范围 |

变化等级：`L0` 为局部实现细节，Tideforge 可直接决定；`L1` 为模块内部设计，Tideforge 提议、Tidewatch 检查并记录；`L2` 为公开 API、所有权、依赖方向或持久化格式，必须回到架构对齐；`L3` 为功能存在性、版本范围或用户体验，必须由用户决定。

Discovery 不应被强行包装成完整 TASK，也不应把临时 spike 当作产品代码；只有证据支持继续后，才进入 Implementation。

## 模块文档机制（README + crate DESIGN）

每个 `agent-core` 模块是对外提供能力的**内部产品**（消费者是 `loop` / `agent` / `cli`，不是终端用户）。

| 文档 | 位置 | 回答的问题 |
|------|------|-----------|
| **`README.md`** | `crates/agent-core/src/{mod}/` | 承诺什么、谁怎么用（~30–60 行） |
| **`DESIGN.md`** | `crates/agent-core/DESIGN.md#{mod}` | 怎么兑现 README 里的承诺 |

**纪律：** 先对齐 README（产品评审），再更新 crate DESIGN 对应节（技术评审）；实现阶段**不得静默偏离 README**。

每个 `src/{mod}/` **必须**维护短 **README**；实现方案写入 crate 级 [`DESIGN.md`](../../../crates/agent-core/DESIGN.md)，不在模块目录重复 `DESIGN.md`。

**任务跟踪：** GitHub Issue + Review 批（由 batch-implement 从 DESIGN 拆出；不再维护 crate 内 `TASKS.md`）。

### 架构对齐 vs 落盘分工

| 阶段 | 类比 | 对话 / 草稿 | 落盘 |
|------|------|-------------|------|
| §1 架构对齐 | **产品评审** | 职责、公开 API、调用边界、与上下游关系 | 暂不落盘，或只记 CONTEXT |
| §2 设计文档 | **产品定稿 + 技术评审** | 用户确认 README 承诺后，补 DESIGN 兑现方案 | README 落 `src/{mod}/`；DESIGN 更新 `crates/agent-core/DESIGN.md#{mod}` |
| §3 实现 | **按图施工** | 契约以 **README** 为准；细节以 **DESIGN** 为准 | 改公开 API → 回 §1 产品评审 |

### 双轨协作（每个实现批次）

实现批次不是只有 Agent 的执行清单，还必须包含一个用户可在等待期间完成的并行任务。用户是产品/架构决策参与者和学习者，不默认承担方案正确性证明或缺陷发现责任；Agent 必须主动完成独立的架构、Spec、Standards、错误路径和验证检查。

| 任务 | 负责者 | 目的 | 要求 |
|---|---|---|---|
| **Agent Task** | Agent | 实现、测试、文档同步、批次自检 | 有明确 scope、diff 预算和验证命令 |
| **User Parallel Task** | 用户 | 掌控项目状态、理解真实代码、练习修改或准备决策 | 15–60 分钟，有文件/路径、产出和验收标准；不要求用户独立证明方案正确 |

User Parallel Task 默认从 `Trace`（追调用链）、`Review`（检查契约/错误路径）、`Practice`（独立小修改/测试）、`Decision`（基于证据做边界决策）中选择。它不应重复 Agent 正在修改的同一文件，也不阻塞 Agent 继续实现；若用户需要改代码，必须指定不冲突的路径或先建立独立工作区。

批次完成时，Agent 交付实现证据，用户交付并行任务产出，双方使用同一组 Shared Acceptance 汇合。不得把 User Parallel Task 变成泛化读书、未来架构发散或额外需求。

### README 推荐结构（对外）

```text
1. 这是什么（一句话 + 磁盘/职责）
2. 设计原理（brief ASCII，一张图足够）
3. 谁该用什么（调用者矩阵 + 禁止项）
4. 公开 API 速查（签名表 / 代码块）
5. 典型用法（按角色：loop / agent / cli）
6. 与相邻模块接缝（链到邻模块 README）
7. 常见错误
8. 进一步阅读 → [`DESIGN.md#mod`](../../../crates/agent-core/DESIGN.md)
```

### DESIGN 推荐结构（实现）

```text
1. 职责与边界
2. 模块结构（目录树）
3. 类型与签名（完整）
4. 核心算法 / 状态机 / 时序图
5. import 边界
6. 不变量
7. 边界情况表
8. 决策记录
9. 实现分期（R1/R2…）
10. 单测方向
```

### 讨论模块开发时的 Agent 纪律

- **产品讨论**（能做什么、谁调用、顺序保证）：README 粒度；先过这关再谈实现。
- **技术讨论**（文件放哪、fold 规则、derive 映射）：DESIGN 粒度；不反向改写 README 已承诺的对外行为。
- **对用户讲解方案**：brief 原理图 + 调用者矩阵（产品面）；争议实现再开 DESIGN。
- **用户说「可以落文档」**：README（产品）与 DESIGN（技术）**同批交付**。
- **用户问「我怎么用」**：只答 README。
- **用户问「怎么实现 / 审查」**：答 DESIGN；若发现 README 承诺不可实现，**停下改 README**，不是偷偷改代码。
- **PROGRESS 设计列**：README ☑ 且 DESIGN ☑ 才算设计完成。

参考实例：`llm/`、`session/`、`event/`（README + crate DESIGN 锚点）。

## 依赖图（推进顺序）

```
契约层  1. llm → 2. session → 3. tools → 4. event
装配层  5. model_input → 6. context
编排层  7. loop
后置    8. scheduler
```

完整 checklist 与接口边界见 [`crates/agent-core/README.md`](../../../crates/agent-core/README.md)。

## 推进模板（硬门禁：先架构对齐）

用户扮演**产品/架构决策参与者与学习者**：掌握到 **trait / 结构体 / enum / 公开函数签名** 这一层；**不**要求用户独立判断所有架构错误，也不讨论函数体、胶水代码、序列化细节、测试样板。Agent 必须把方案依据、替代方案、风险、反例和验证证据讲清楚，并主动指出用户可能无法发现的错误。

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
2. **停下来等用户确认或修订**——用户确认的是目标、边界和可接受取舍，不等同于用户已证明方案正确；Agent 仍需独立验证并披露未证实假设。
3. 有分歧时先辩清楚再往下；用户未明确「可以落文档 / 可以写代码」之前，**不写实现、不建源码文件**。
4. 确认结果写入对话结论；若决策可复用，补一条到 [CONTEXT.md](CONTEXT.md)「关键设计决策速查」。

`PROGRESS.md` 在本阶段将模块标为 `◐ 设计对齐中`。

### 2. 设计文档（确认后才写）

用户确认接口后：

- **`crates/agent-core/src/{mod}/README.md`** — 短集成说明：调用者矩阵、公开 API 速查、链接到 DESIGN 锚点
- **`crates/agent-core/DESIGN.md#{mod}`** — 实现技术方案：模块结构、类型签名、算法、不变量、决策记录、单测方向

架构对齐对话中：**对外契约**写入 README 草案；**内部方案**写入 crate DESIGN 对应节草案。用户可分两次确认，但落盘时 README + DESIGN 节齐全再标设计 ☑。

`PROGRESS.md`：设计文档勾选完成（README + DESIGN）。

### 3. 实现 + 单测（子 skill：分批 review · commit）

设计文档 ☑ 后，**必须**走子 skill [batch-implement](batch-implement/SKILL.md)：

1. 从 **DESIGN.md**（+ README 公开 API）在 GitHub 创建 Issue（Review 批 + 细 TASK；可参考子 skill 内 [`llm-TASKS.example.md`](batch-implement/llm-TASKS.example.md)）
2. 与用户确认本批 TASK、User Parallel Task 和 Shared Acceptance（默认一个 Review 批配一个用户任务）
3. 实现 + `just check` + 批次自检；用户并行完成 User Parallel Task → **停等用户 git diff review**
4. 用户说 **commit** 后再提交；勾选 TASK → 下一批
5. 全部 TASK ☑ 后进入 §4 收尾

实现阶段若发现必须改公开签名，**先回到第 1 段与用户对齐**，禁止静默改契约。

### 4. 收尾

更新 [PROGRESS.md](PROGRESS.md)：勾选实现 / 测试，更新「当前目标」指向下一模块。

## 完成后

进入下一模块时，再次从「架构对齐」开始，不假设用户还记得上一模块细节——用 PROGRESS + CONTEXT 冷启动。
