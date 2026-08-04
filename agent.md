# Agent 协作偏好

## 用词：专业、简洁、清晰

**原则：** 文档、设计说明与对话中，优先使用业界可核对的专业术语；避免为省事而造的口语、隐喻或代指。

| 偏好 | 避免 |
|------|------|
| **API 适配层**、**adapter**、**Provider preset**、**Harness**（有明确定义时） | 自造黑话（如未定义的「Wire」指 HTTP 层） |
| 一词一义；新词首次出现给定义或链到 Spec | 隐喻代替精确描述（「最后一跳」「那层」不带结构名） |
| 与代码目录 / 接口名一致（`adapters/*`、`LLMProvider`） | 口头简称与正式文档用语不一致 |
| 简洁但不牺牲可检索性 | 过长绕述或堆砌缩写 |

**判据：** 读者能否在不问作者的情况下，从术语联想到**具体模块、边界或职责**；若不能，则换词或补一句定义。

**示例（Ocula）：**

- ✅ 「Harness 与 **API 适配层**分离」— adapter 负责 `LLMRequest` ↔ 厂商 SDK  
- ❌ 「Harness 与 Wire 分离」— Wire 非通用架构术语，易与 wire protocol 混淆  

**范围：** 架构文档（[`docs/`](docs/README.md)）、PR/Issue、Agent 产出物；口语讨论可临时用简称，**落盘时必须规范化**。

**文档索引：** [`docs/README.md`](docs/README.md) — `product/`（方向）、`spec/`（设计 Spec）、`notes/`（分析与候选）；文件名一律小写 kebab-case。

---

## 工程原则

### 1. 分层与约束

**原则：** 依赖单向流动；每层只做一类事；边界用可检查的约束守住，不靠约定俗成。

| 层 | 职责 | 约束 |
|----|------|------|
| **原语层**（如 `utils/`） | 跨平台 IO、子进程、glob 等 Node 封装 | **唯一**允许直接 touch 对应 builtin 的层 |
| **约定层**（如 `storage/`） | 项目持久化格式（NDJSON、JSON pretty、list） | 委托原语层，不重复 import builtin |
| **业务层**（agent、context、builtins…） | 领域逻辑 | 不越层访问 OS / FS / 子进程 |

**配套做法：**

- **单一入口** — 横切能力只暴露一个门面（如 `checkPermission`、`emitDraft`、`resolveInstructionState`）；调用方不认实现细节。
- **例外显式** — 必须越层的场景（如 sidecar IPC spawn、注入沙箱的用户脚本）单独列出，不默许扩散。
- **可验收** — 用 grep / lint 验证 import 边界，而不只写在 README。

**判据：** 新增功能时，能否明确说出「改哪一层、不该碰哪一层」；若只能写散落 `if`，说明边界未清。

**示例（Ocula）：**

- ✅ `builtins/fs` → `utils/fs` → `node:fs`；`storage/fs` 只做 Ocula 路径约定  
- ✅ Session Item Log 为事实源，Agent Event Log 仅派生，不反向写 Session  
- ❌ 业务模块直接 `import fs from "node:fs"`，或 observability 与 compose 共用可变 messages 数组  

**参考：** [`docs/notes/utils-infrastructure.md`](docs/notes/utils-infrastructure.md)

---

### 2. 声明式优于命令式

**原则：** 行为由**数据 / 配置 / 规则表**描述，运行时按固定顺序解释；避免为每种情况写独立分支。

| 偏好 | 避免 |
|------|------|
| 规则数组 / 映射表（先匹配先返回） | 长链 `if / else if` 或 `switch` 堆叠 |
| 固定 lifecycle phase + `PHASE_DEFS` | 散落 callback、各模块自行 hook 时机 |
| `Record<tool, Rule>` + `kind` 判别 | 每个 tool 一个 handler 函数 |
| 扩展 = 加一行配置 | 扩展 = 改多处控制流 |

**判据：** 新增一条规则或一个 tool，是否**只改一处表**而不动解释器逻辑；若每次都要改 `switch`，应抽象。

**示例（Ocula）：**

- ✅ `BASH_COMMAND_RULES` — deny / ask pattern 分组，顺序匹配  
- ✅ `TOOL_RULES` — `fixed` / `bash` / `path` 三种 kind，未知 tool 默认 `allow`  
- ✅ `HookDispatcher` + `PHASE_DEFS` — phase 名、mode、errorPolicy 一处定义  
- ❌ `matchesNetworkAsk` / `matchesGrepAsk` 各写一条 `if`，或 tool 权限用 20 个 `case`  

**与分层的关系：** 分层定「谁该在哪」；声明式定「在那层里怎么表达规则」——二者配合，控制复杂度随功能线性增长，而非指数增长。

### 3. 术语（Session / Context）

一词一义，完整表见 [`docs/spec/context-composer.md` §1.4](docs/spec/context-composer.md#14-术语一词一义)：

| 过程 | 用词 | 代码 |
|------|------|------|
| Item Log → `SessionMessage[]` | **materialize / 还原** | `messagesFromItems` · `applyItemToMessages` |
| Session → `LLMRequest` | **compile / 编译** | `composeContext` |
| Item → Agent Event | **derive / 派生** | `deriveFromSessionItem` |

文档与讨论中**避免**用「投影 / Projection」指上述过程。

