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
- **可验收** — 用不变量测试 / grep 验证 import 边界，而不只写在 README（见 §6）。

**判据：** 新增功能时，能否明确说出「改哪一层、不该碰哪一层」；若只能写散落 `if`，说明边界未清。

**示例（Ocula）：**

- ✅ `tools/builtins/fs` → `utils/fs` → `node:fs`；`storage/fs` 只做 Ocula 路径约定  
- ✅ Session Item Log 为事实源，Agent Event Log 仅派生，不反向写 Session  
- ❌ 业务模块直接 `import fs from "node:fs"`，或 observability 与 compose 共用可变 messages 数组  

**参考：** [`docs/notes/utils-infrastructure.md`](docs/notes/utils-infrastructure.md)

层内模块仍须满足 §2 内聚/耦合判据。

---

### 2. 模块：高内聚、低耦合

**原则：** 模块内相关职责聚在一起（高内聚）；模块间通过窄接口依赖（低耦合）。

| | 高内聚 | 低耦合 |
|---|--------|--------|
| **偏好** | 一模块一变更理由；materialize / derive / compile 分文件；`AgentSession` 不兼 compact + checkpoint + run | 依赖 port / 接口而非具体实现；`src/session/` 不知 Harness hook；permission 随 `ToolSpec` 注册 |
| **避免** | 同文件混 Item 还原与 Agent Event 派生；门面类堆叠无关命令 | `session/` import `agent/`；tool 权限与 manifest 两处手工同步 |

**与 §1 分工：** §1 管**纵向层间**依赖；§2 管**横向模块**职责纯度与接口宽度。

**判据：**

- **内聚：** 能否用一句不含「并且」描述模块职责？
- **耦合：** 改 A 是否常被迫改 B？

**示例（Ocula）：**

- ✅ [`instruction-state`](src/instruction-state/) — `load` / `resolve` 分离  
- ❌ [`session.ts`](src/session/session.ts) `import agent/hooks`  
- ❌ [`item-handlers.ts`](src/session/item-handlers.ts) 混 materialize + derive  

**可验收：** `rg 'from.*agent/' src/session/` 为零；新模块声明 public API（`index.ts` 或 `types.ts`）。

**工程取舍：** 允许简单冗余，见 §3；高内聚、低耦合 **不意味着** 凡相似必合并。

**参考：** [`docs/notes/architecture-remediation.md`](docs/notes/architecture-remediation.md) §1/§10 · [`docs/spec/context-composer.md`](docs/spec/context-composer.md) §4

---

### 3. 简单冗余优于过度抽象

**原则：** 允许**有意识的简单重复**；不为消重复而加 indirection，除非抽象能**降低认知负担**或**消除真实耦合**（而非仅减少行数）。

| 偏好 | 避免 |
|------|------|
| 结构相似、**各自独立**的实现（各 store 一份 File 类，路径/字段差异 inline 可见） | 为相似模块抽泛型 base / 工厂，读代码需多跳一层才懂约定 |
| 重复少量、语义清晰的代码 | 「省 15 行」但多一个概念、多一条调用链 |
| **规范单测**守门（tool / hook / extension / plugin 注册表） | 为「理论上可能」的 shape 漂移加 runtime validator |
| 抽象前先问：**删掉这层，维护者是否更快定位行为？** | 默认 DRY：凡重复必抽 |

**判据：** 抽象是否让**下一个读代码的人**更快理解，而不是让**当前作者**少写几行。若相似模块的差异点（路径、排序、类型字段）比共同点更值得一眼看到，保留重复。

**示例（Ocula）：**

- ✅ `FileCompactionStore` · `FileCheckpointStore` · `FileArtifactStore` 三份独立实现 — 各文件的 get/list/save 与路径约定同屏可读  
- ❌ `JsonRecordStore<T>` + 三个 thin wrapper — 共性只有「JSON 文件 CRUD」，差异（`compactionDir` vs `artifactId` 布局）被藏进 factory 参数  
- ✅ 新增 builtin / extension / plugin tool 必须过规范单测 — 测试失败则不能提交（见 §5）  
- ❌ `to-message-params` 加 runtime assert — compose / transform oracle 测试已覆盖即可（见 §6）

**与其他原则的关系：** §1 分层、§4 声明式解决**边界与扩展**；本条约束**层内与模块间**何时不值得抽象。高内聚、低耦合 **不意味着** 凡相似必合并。

---

### 4. 声明式优于命令式

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
- ✅ `ToolSpec.permission` — `fixed` / `bash` / `path` 三种 kind；permission 表见 [`permission-table.ts`](src/tools/permission-table.ts)；未知 tool **deny**  
- ✅ `HookDispatcher` + `PHASE_DEFS` — phase 名、mode、errorPolicy 一处定义  
- ❌ `matchesNetworkAsk` / `matchesGrepAsk` 各写一条 `if`，或 tool 权限用 20 个 `case`  

**与分层的关系：** 分层定「谁该在哪」；声明式定「在那层里怎么表达规则」——二者配合，控制复杂度随功能线性增长，而非指数增长。

---

### 5. 规范单测（Conformance）

**原则：** 凡**声明式注册表**（tool manifest、hook manifest、plugin manifest）应用单测守门；新增条目未合规则 CI / pre-commit 失败。用测试替代 runtime validator，与 §3 一致。

**范围（四类来源，均须覆盖）：**

| 来源 | 注册入口 | 规范单测关注点 |
|------|----------|----------------|
| **Builtin** | [`register-defaults.ts`](src/tools/register-defaults.ts) · `tools/builtins/*-tools.ts` | 每条 `ToolSpec` 含 `permission`；name 与 `TOOL_NAMES` 一致 |
| **Extension** | 同上 manifest 的 extension 工厂（如 `code_repl`、`deep_research`） | 与 builtin **同一套** permission / schema 规则；optional 工厂返回 null 时跳过 |
| **Hook（内置）** | [`buildDefaultHookManifest()`](src/agent/hooks/manifest.ts) | `phase` ∈ `PHASE_DEFS`；同 phase 内 `name` 唯一；`errorPolicy` 合法 |
| **Plugin（sidecar）** | [`defineSidecarPlugin`](src/plugins/sdk/define.ts) · [`plugins.json`](src/plugins/host/manifest.ts) | manifest 条目 `id/kind/attach` 合法；sidecar 暴露的 hook（`listSidecarHooks`）与 tool 经 attach 后同样受检 |

**计划测试文件：**

| 文件 | 职责 |
|------|------|
| [`tests/architecture-boundaries.test.ts`](tests/architecture-boundaries.test.ts) | 结构不变量：`session/` 零 `agent/` import；`agent/`·`context/` 零 SDK；SDK 仅在 `llm/adapters`·`client` |
| `tests/tool-permissions.test.ts` | 遍历 `registerDefaultTools()` → 每条 tool 与 `TOOL_PERMISSIONS` 表一致 |
| `tests/hook-manifest.test.ts` | `buildDefaultHookManifest()` → phase / name / errorPolicy；无 `sessionItem/file` |
| `tests/plugin-manifest.test.ts` | `loadPluginManifest` / manifest 条目 schema；sidecar ready 握手与 hook·tool 列表快照（可选） |

**pre-commit：** `.husky/pre-commit` 跑 `pnpm run test:conformance`（结构边界 + hook manifest + tool permission）；全量 `pnpm test` 仍由 CI / 本地 `pnpm check` 覆盖。

**Plugin tool 命名：** sidecar 注册 tool 使用 `pluginId__toolName`（[`ToolRegistry.pluginToolName`](src/agent/runtime/tool-registry.ts)）；permission 随 `ToolDefinition` 一并声明，默认 **deny**，显式 opt-in。

**与 §6 关系：** §5 是 §6「注册表类不变量」的子集；§6 覆盖变换、行为、架构等更广的不变量。

**参考：** [`docs/notes/architecture-remediation.md`](docs/notes/architecture-remediation.md)（架构修复计划）· [`docs/notes/plugin-host.md`](docs/notes/plugin-host.md) · [`docs/notes/agent-run-hooks.md`](docs/notes/agent-run-hooks.md)

---

### 6. 不变量与契约测试（Invariants & Contracts）

**原则：** 开发者脑中的「运行时应该长什么样」——数据结构、模块边界、派生规则、hook 语义——应写成**可失败的不变量测试**，而不是只靠 code review 或 scattered runtime assert。测试即**可执行的契约**。

**业界对应（可检索）：**

| 术语 | 含义 | Ocula 落点 |
|------|------|------------|
| **Design by Contract（契约式设计）** | 前置条件、后置条件、**不变量**；违反即 bug | Item Log 为事实源；derive 不反向写 Session |
| **Architecture Fitness Function（架构适应度函数）** | 自动化检查架构约束是否仍成立 | `session/` 不得 import `agent/` |
| **Conformance / Contract testing** | 实现是否符合声明的 schema / manifest | §5 hook·tool manifest 单测 |
| **Oracle test（神谕测试）** | 已知输入 → 期望输出，验证纯函数语义 | `messagesFromItems` → 固定 `Message[]` |
| **Round-trip invariant（往返不变量）** | A→B→A 或 encode→decode 应还原 | Item materialize 与 compose 链路（分期补全） |
| **Test double at port（端口替身）** | 在边界注入 mock，不测 SDK 内部 | `setLLMProvider()` · `createSessionCommitPort()` |

**不变量分层（写测试前先归类）：**

| 类 | 测什么 | 典型手段 | 本仓库示例 |
|----|--------|----------|--------------|
| **结构** | 依赖方向、禁止 import | 源码扫描 / ArchUnit 式单测 | [`tests/session-ports.test.ts`](tests/session-ports.test.ts) |
| **注册表** | 声明式表条目合法、唯一 | 遍历 manifest + 断言 | §5 · [`tests/hooks-registry.test.ts`](tests/hooks-registry.test.ts) |
| **变换** | 纯函数：Log/Item → Message/Request | 表格用例 + 精确 `toEqual` | [`tests/log-to-messages.test.ts`](tests/log-to-messages.test.ts) · [`tests/session-transform.test.ts`](tests/session-transform.test.ts) |
| **行为** | 解释器语义：顺序、errorPolicy、隔离 | spy 顺序 / 副作用收集 | [`tests/hooks-order.test.ts`](tests/hooks-order.test.ts) · [`tests/hook-failures.test.ts`](tests/hook-failures.test.ts) |
| **集成状态** | 一次 run 后跨模块状态一致 | 端到端 + 读 log/event 快照 | [`tests/log-sync.test.ts`](tests/log-sync.test.ts) · [`tests/run-storage.test.ts`](tests/run-storage.test.ts) |
| **事件形状** | 派生 event 字段、seq、channel | schema / 快照断言 | [`tests/events-schema.test.ts`](tests/events-schema.test.ts) |

**配套做法：**

- **先写不变量，再写实现** — 新 pipeline（如 Item→Message、compose、derive）先列「哪些输入/状态下必须成立什么」，每条对应至少一个测试名能读懂的 `it(...)`。
- **不变量优先于覆盖率** — 一条清晰的「Session 零 agent 依赖」胜过百行未断言的集成跑通。
- **测试替身打在 port，不打在叶子** — mock `getLLMProvider` / commit port，不 mock 半条 transform 链；与 §1 边界一致。
- **用测试代替 runtime validator** — 与 §3 一致：compile-time / CI 能守住的 shape，不在热路径加 `assert`；不可信输入（用户文件、sidecar JSON）另议。
- **文档里的 Spec = 测试的索引** — Spec 写「应然」；不变量测试写「仍然」；二者不一致时以测试失败驱动修 Spec 或修代码。

**判据：** 改完模块后能否回答——**(1) 哪条不变量可能被破坏？(2) 现有哪条测试会红？(3) 若没有，是否该补？** 若三项都答不出，说明契约未显式化。

**示例（Ocula）：**

- ✅ `log-to-messages` — tool_use 后 tool_outcome 必须合并为带 `tool_result` 的 user message  
- ✅ `hooks-order` — 某 handler throw 时同 phase 后续 handler 仍执行（`errorPolicy: observe`）  
- ✅ `log-sync` — 一次 user commit 只 derive 一条 `user_prompt`，tool 轮不重复 trace  
- ❌ 只在 PR 描述写「Session 不依赖 Harness」，无 [`session-ports.test.ts`](tests/session-ports.test.ts) 类门禁  
- ❌ 为 `toMessageParams` 加 runtime typeof 检查 — compose / transform 已有 oracle 测试即可  

**参考：** Meyer, *Object-Oriented Software Construction*（Design by Contract）· Ford et al., *Building Evolutionary Architectures*（Fitness Functions）· [`docs/spec/context-composer.md`](docs/spec/context-composer.md) §1.4 术语与 materialize/compile/derive 边界

---

### 7. 术语（Session / Context）

一词一义，完整表见 [`docs/spec/context-composer.md` §1.4](docs/spec/context-composer.md#14-术语一词一义)：

| 过程 | 用词 | 代码 |
|------|------|------|
| Item Log → `SessionMessage[]` | **materialize / 还原** | `messagesFromItems` · `applyItemToMessages` |
| Session → `LLMRequest` | **compile / 编译** | `composeContext` |
| Item → Agent Event | **derive / 派生** | `plugins/builtin/log-sync/item-derive-handlers` · `deriveFromSessionItem` |

文档与讨论中**避免**用「投影 / Projection」指上述过程。

