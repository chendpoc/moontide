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

## 模块文档机制（README + DESIGN）

每个 `agent-core` 模块是对外提供能力的**内部产品**（消费者是 `loop` / `agent` / `cli`，不是终端用户）。双文档对应两轮评审：

| 文档 | 类比 | 回答的问题 | 评审焦点 |
|------|------|-----------|----------|
| **`README.md`** | **产品需求 / 对外契约**（PRD 粒度） | 这个模块**承诺什么**、**谁怎么用**、**不能做什么** | 职责边界、公开 API、调用者矩阵、典型流程、与邻模块接缝 |
| **`DESIGN.md`** | **技术方案 / 实现设计**（Tech Design 粒度） | **怎么兑现** README 里的承诺 | 目录结构、算法、不变量、错误策略、分期、单测 |

```text
README（产品面）          DESIGN（实现面）
  承诺的能力        →        兑现该承诺的工程方案
  对外 API          →        内部模块划分与算法
  集成方心智        →        实现者 / reviewer 心智
```

**纪律：** 先对齐 README（产品评审通过），再写 DESIGN（技术评审）；实现阶段**不得静默偏离 README**；README 变更视为产品变更，须回到架构对齐。

每个 `crates/agent-core/src/{mod}/` **必须**维护两份文档，职责分离：

| 文件 | 读者 | 写什么 | 不写什么 |
|------|------|--------|----------|
| **`README.md`** | 集成方（`agent` / `loop` / `cli` / 测试作者） | 模块是什么、brief 原理 ASCII 图、**谁该用什么**、公开 API 速查、典型用法、常见错误 | 文件树细节、fold 算法、derive 映射表、单测清单 |
| **`DESIGN.md`** | 实现者 / reviewer | 模块结构、类型**完整**签名、算法步骤、import 边界、不变量、边界情况、决策记录、实现分期、单测方向 | 冗长教程式「怎么用」（应链到 README） |

可选第四份：**`TASKS.md`** — 实现阶段由 batch-implement 从 DESIGN 拆出，跟踪 Review 批与细 TASK。

### 架构对齐 vs 落盘分工

| 阶段 | 类比 | 对话 / 草稿 | 落盘 |
|------|------|-------------|------|
| §1 架构对齐 | **产品评审** | 职责、公开 API、调用边界、与上下游关系 | 暂不落盘，或只记 CONTEXT |
| §2 设计文档 | **产品定稿 + 技术评审** | 用户确认 README 承诺后，补 DESIGN 兑现方案 | **同时**落 README + DESIGN |
| §3 实现 | **按图施工** | 契约以 **README** 为准；细节以 **DESIGN** 为准 | 改公开 API → 回 §1 产品评审 |

### README 推荐结构（对外）

```text
1. 这是什么（一句话 + 磁盘/职责）
2. 设计原理（brief ASCII，一张图足够）
3. 谁该用什么（调用者矩阵 + 禁止项）
4. 公开 API 速查（签名表 / 代码块）
5. 典型用法（按角色：loop / agent / cli）
6. 与相邻模块接缝（链到邻模块 README）
7. 常见错误
8. 进一步阅读 → DESIGN.md
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

参考实例：`llm/`、`session/`、`event/`（均已拆分）。

## 依赖图（推进顺序）

```
契约层  1. llm → 2. session → 3. tools → 4. event
装配层  5. model_input → 6. context
编排层  7. loop
后置    8. scheduler
```

完整 checklist 与接口边界见 [`crates/agent-core/README.md`](../../../crates/agent-core/README.md)。

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

用户确认接口后，写入 `crates/agent-core/src/{mod}/`（见上文 **模块文档机制**）：

- **`README.md`** — 对外使用说明：调用者矩阵、公开 API 速查、典型用法、brief 原理 ASCII 图
- **`DESIGN.md`** — 实现技术方案：模块结构、类型签名、算法、不变量、决策记录、实现分期、单测方向

架构对齐对话中：**对外契约**写入 README 草案；**内部方案**写入 DESIGN 草案。用户可分两次确认，但落盘时两份齐全再标设计 ☑。

`PROGRESS.md`：设计文档勾选完成（README + DESIGN）。

### 3. 实现 + 单测（子 skill：分批 review · commit）

设计文档 ☑ 后，**必须**走子 skill [batch-implement](batch-implement/SKILL.md)：

1. 从 **DESIGN.md**（+ README 公开 API）生成 `src/{mod}/TASKS.md`（可参考子 skill 内 `llm-TASKS.example.md`）
2. 与用户确认本批 TASK（默认 1 个/批）
3. 实现 + `just check` → **停等用户 git diff review**
4. 用户说 **commit** 后再提交；勾选 TASK → 下一批
5. 全部 TASK ☑ 后进入 §4 收尾

实现阶段若发现必须改公开签名，**先回到第 1 段与用户对齐**，禁止静默改契约。

### 4. 收尾

更新 [PROGRESS.md](PROGRESS.md)：勾选实现 / 测试，更新「当前目标」指向下一模块。

## 完成后

进入下一模块时，再次从「架构对齐」开始，不假设用户还记得上一模块细节——用 PROGRESS + CONTEXT 冷启动。
