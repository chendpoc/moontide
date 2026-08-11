
本文件是 MoonTide 的 **Agent 指令源**（经 `instruction-state` 注入 compose）与 **开发规则** 的唯一入口。工程原则、用词规范、命令与 Git 约定均在此维护。

---

## 对话风格

- 回答保持简短精炼
- 提交信息、issue、PR 评论和代码中不使用 emoji
- 不要客套话或欢快的填充语（例如："Thanks @user" 而不是 "Thanks so much @user!"）
- 只写技术性文字，直接了当
- 用户提问时，先回答问题，再进行编辑或执行实现命令。
- 回应反馈或分析时，先明确表示同意或不同意，再说明你改了什么。

---

## 用词：专业、简洁、清晰

**原则：** 文档、设计说明与对话中，优先使用业界可核对的专业术语；避免为省事而造的口语、隐喻或代指。

| 偏好 | 避免 |
|------|------|
| **API 适配层**、**adapter**、**Provider preset**、**Harness**（有明确定义时） | 自造黑话（如未定义的「Wire」指 HTTP 层） |
| 一词一义；新词首次出现给定义或链到 Spec | 隐喻代替精确描述（「最后一跳」「那层」不带结构名） |
| 与代码目录 / 接口名一致（`adapters/*`、`LLMProvider`） | 口头简称与正式文档用语不一致 |
| 简洁但不牺牲可检索性 | 过长绕述或堆砌缩写 |

**判据：** 读者能否在不问作者的情况下，从术语联想到**具体模块、边界或职责**；若不能，则换词或补一句定义。

**示例（MoonTide）：**

- ✅ 「Harness 与 **API 适配层**分离」— adapter 负责 `LLMRequest` ↔ 厂商 SDK
- ❌ 「Harness 与 Wire 分离」— Wire 非通用架构术语，易与 wire protocol 混淆
- ✅ loop **publish** RunEvent，经 **RunEvent bus** fan-out 给 subscribe / EventOutput
- ❌ 「sink 收日志」— 未定义；用 **RunEvent bus**（进程内 pub/sub 门面）
- ✅ run 前 **resolveRunConfig**，每 turn LLM 前 **resolveTurnContext**
- ❌ 「fold hook / fold config」— 用 **resolveRunConfig**（run 级）与 **resolveTurnContext**（turn 级）

**范围：** 架构文档（[`docs/`](docs/README.md)）、PR/Issue、Agent 产出物；口语讨论可临时用简称，**落盘时必须规范化**。

**文档索引：** [`docs/README.md`](docs/README.md) — `product/`（方向）、`spec/`（设计 Spec）、`notes/`（分析与候选）；文件名一律小写 kebab-case。

---

## 代码质量

- 在进行大范围修改、编辑未完整检查过的文件、或要求调查/审计时，先完整读取文件。大范围改动不要依赖搜索片段。
- 除非绝对必要，否则不用 `any`。
- 只有一个调用点的单行辅助函数应内联。
- 检查 node_modules 中的外部 API 类型；不要猜测。
- **禁止内联导入**（`await import()`、`import("pkg").Type`、动态类型导入）。只用顶层导入。
- **源码只使用 `.ts`。** 禁止在 `src/`（及 package 源码目录）提交 `.js` / `.mjs`；编译产物仅出现在 `dist/`。TS 内 ESM import 的 `.js` 后缀（NodeNext）除外。
- **`_` 前缀 = 模块内部。** 函数 / 常量以 `_` 开头表示仅在本文件（编译单元）内使用，**不得 export**。对外 API 用无 `_` 名称；模块内步骤用 `_foo` 拆分。与 ESLint `@typescript-eslint/no-unused-vars` 的 `varsIgnorePattern: "^_"` 一致——有意忽略的未使用参数也用 `_`，二者不冲突（参数位置 vs 模块私有符号）。
- 删除看似有意的功能或代码前，务必先询问。
- 除非用户要求，否则不保留向后兼容。

---

## 命令

- 代码变更后（文档除外）：运行 `pnpm run check`（完整输出，不要 tail）。修复所有错误、警告和 info 后再提交。
- `pnpm run check` = `lint` + `typecheck` + `test`（全量 vitest）。
- 未经用户要求，绝不运行 `pnpm run build` 或 `pnpm test`。
- 创建或修改测试文件后，运行该文件并迭代测试或实现直到通过：`pnpm exec vitest run tests/<name>.test.ts`。
- 规范单测（结构边界、hook manifest、tool permission 等）：`pnpm run test:conformance`（pre-commit 已包含）。
- 临时脚本用 `write` 写到临时文件（例如 `/tmp`），运行、需要时修改、用后删除。不要把多行脚本嵌在 `bash` 命令里。
- 未经用户要求，绝不提交。

---

## Git

当前 cwd 可能同时运行多个 agent 会话，各自修改不同文件。凡是触碰你自己变更之外未暂存、已暂存或未跟踪文件的 Git 操作，都会踩坏其他会话的工作。遵守以下规则：

**提交：**

- 只提交你本次会话中自己改过的文件。
- 显式暂存路径（`git add <path1> <path2>`）；绝不 `git add -A` / `git add .`。
- 提交前运行 `git status`，确认只暂存了自己的文件。
- 提交信息格式：`{feat,fix,docs}[(scope)]: <commit message>`（可多行）。信息要有信息量且简洁。

**绝不运行（会毁掉其他 agent 的工作或绕过检查）：**

- `git reset --hard`、`git checkout .`、`git clean -fd`、`git stash`、`git add -A`、`git add .`、`git commit --no-verify`。

**rebase 冲突时：**

- 只解决你修改过的文件中的冲突。
- 冲突出现在你未修改的文件中时，中止并询问用户。
- 绝不 force push。

---

## Issue 与 PR

审查 PR 时：

- 除非用户明确要求，不运行 `gh pr checkout`、`git switch` 或任何把工作树切到 PR 分支的操作。
- 用 `gh pr view`、`gh pr diff`、`gh api` 和本地 `git show`/`git diff`（针对已 fetch 的 ref）检查 PR 元数据、提交和补丁，不切换分支。
- 需要 PR 文件内容时，fetch/读取到临时文件，或用 `git show <ref>:<path>`，不切换分支。

发布 issue/PR 评论时：

- 评论写到临时文件，用 `gh issue/pr comment --body-file` 发布（绝不用 `--body` 传多行 markdown）。
- 评论保持简洁、技术性、贴合用户的语气。

通过提交关闭 issue 时：

- 在提交信息中包含 `fixes #<number>` 或 `closes #<number>`，合并时自动关闭 issue。多个 issue 时每个 issue 重复关键字（`closes #1, closes #2`）；共享关键字（`closes #1, #2`）只关闭第一个。

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

- **单一入口** — 横切能力只暴露一个门面（如 `checkPermission`、`emit`、`resolveInstructionState`）；调用方不认实现细节。
- **例外显式** — 必须越层的场景（如 sidecar IPC spawn、注入沙箱的用户脚本）单独列出，不默许扩散。
- **可验收** — 用不变量测试 / grep 验证 import 边界，而不只写在 README（见 §6）。

**判据：** 新增功能时，能否明确说出「改哪一层、不该碰哪一层」；若只能写散落 `if`，说明边界未清。

**示例（MoonTide）：**

- ✅ `tools/builtins/workspace/fs` → `utils/fs` → `node:fs`；`storage/fs` 只做 MoonTide 路径约定
- ✅ Session Item Log 为事实源，Agent Event Log 仅派生，不反向写 Session
- ❌ 业务模块直接 `import fs from "node:fs"`，或 observability 与 compose 共用可变 messages 数组

**参考：** [`docs/notes/runtime/utils-infrastructure.md`](docs/notes/runtime/utils-infrastructure.md)

层内模块仍须满足 §2 内聚/耦合判据。

---

### 2. 模块：高内聚、低耦合

**原则：** 模块内相关职责聚在一起（高内聚）；模块间通过窄接口依赖（低耦合）。

| | 高内聚 | 低耦合 |
|---|--------|--------|
| **偏好** | 一模块一变更理由；materialize / derive / compile 分文件；`AgentSession` 不兼 compact + checkpoint + run | 依赖 port / 接口而非具体实现；`packages/session` 不知 Harness hook；permission 随 `ToolSpec` 注册 |
| **避免** | 同文件混 Item 还原与 Agent Event 派生；门面类堆叠无关命令 | `session/` import `agent/`；tool 权限与 manifest 两处手工同步 |

**与 §1 分工：** §1 管**纵向层间**依赖；§2 管**横向模块**职责纯度与接口宽度。

**判据：**

- **内聚：** 能否用一句不含「并且」描述模块职责？
- **耦合：** 改 A 是否常被迫改 B？

**示例（MoonTide）：**

- ✅ [`instruction-state`](packages/agent/src/instruction-state/) — `load` / `resolve` 分离
- ❌ [`session.ts`](packages/session/src/session.ts) `import agent/hooks`
- ❌ [`item-handlers.ts`](packages/session/src/item-handlers.ts) 混 materialize + derive

**可验收：** `rg 'from.*agent/' packages/session/src/` 为零；新模块声明 public API（`index.ts` 或 `types.ts`）。

**工程取舍：** 允许简单冗余，见 §3；高内聚、低耦合 **不意味着** 凡相似必合并。

**参考：** [`docs/notes/runtime/architecture-remediation.md`](docs/notes/runtime/architecture-remediation.md) §1/§10 · [`docs/spec/context-composer.md`](docs/spec/context-composer.md) §4

#### 2.1 声明与实现分离（Spec / Impl Split）

**原则：** 凡模块同时承担 **对外契约**（schema、permission、manifest 条目、注册表行）与 **运行时行为**（IO、副作用、算法），必须拆成至少两个编译单元：**声明层（spec）** 与 **实现层（impl）**。禁止在同一文件内混写 spec + handler 的 monolith——与条目数量无关，**lone entry 不是例外**。

| | 声明层（spec） | 实现层（impl） |
|---|----------------|----------------|
| **职责** | 描述「是什么、谁能调、输入长什么样」 | 描述「怎么跑、失败怎么办」 |
| **典型内容** | `ToolSpec`、`HookManifest` 行、`plugins.json` 条目、JSON Schema | `runXxx`、`handler`、sidecar 入口脚本 |
| **变更理由** | 对外契约、权限、模型可见字段 | 算法、IO、错误语义 |
| **测试侧重** | Conformance / manifest 遍历 | Oracle、mock port 的单元测试 |

**通用判据（写代码前自问）：**

1. 改行为（算法、超时、错误文案）时，是否**不应**动 schema / permission / manifest？
2. 改契约（新增字段、改 permission kind）时，是否**不应**动 IO 与子进程细节？
3. 若两问任一答「否」，说明 spec 与 impl 仍耦在同一文件，应拆。

**硬规则（MoonTide 强制执行）：**

| 规则 | 说明 |
|------|------|
| **No monolith module** | impl 文件不得 export `ToolSpec` / `defineTool(s)` / manifest 工厂；spec 文件不得含 `spawn`、网络、FS 等副作用 |
| **Lone entry 仍分层** | 域内仅一个 tool 也保留 `<domain>/tools.ts` + `<domain>/<impl>.ts`，不用 `defineXxxTool(): ToolDefinition` 单数 factory |
| **按域分目录** | `tools/builtins/<domain>/` — 域内共享 impl（如 `workspace/fs.ts`、`git/lib.ts`），域间通过窄 import 复用 |
| **注册单一形状** | manifest 工厂统一 `defineXxxTools(): ToolDefinition[]`；禁止 `singleTool()` 仅为适配 monolith |
| **可验收** | 结构扫描：impl 路径不得出现 `defineTool` / `ToolSpec`；spec 路径（`*tools.ts`、manifest）不得直接 `spawn` / `node:fs`（沙箱模板等显式列出的例外另议） |

**业界对应：** *Separation of Interface and Implementation* · *Registration vs Execution* · 声明式注册表（§4）的物理落盘——表是 spec，解释器调用的 handler 是 impl。

**示例（MoonTide）：**

- ✅ [`tools/builtins/shell/bash.ts`](packages/tools/src/builtins/shell/bash.ts)（`runBash`）+ [`shell/tools.ts`](packages/tools/src/builtins/shell/tools.ts)（`ToolSpec` + `defineShellTools`）
- ✅ [`tools/builtins/context/inspect-context.ts`](packages/tools/src/builtins/context/inspect-context.ts) + [`context/tools.ts`](packages/tools/src/builtins/context/tools.ts)
- ✅ [`plugins/builtin/code-repl/tools.ts`](packages/agent/src/plugins/builtin/code-repl/tools.ts)（spec）+ [`executor.ts`](packages/agent/src/plugins/builtin/code-repl/executor.ts)（impl）
- ✅ [`agent/hooks/manifest.ts`](packages/agent/src/agent/hooks/manifest.ts)（声明） vs 各 handler 文件（实现）
- ✅ Sidecar：`plugins.json`（attach 契约） vs `entry` 脚本（运行时）— 天然 spec/impl 分进程
- ❌ 单文件内 `const SPEC: ToolSpec = { …, run: async () => { spawn… } }` + `export function defineFooTool()`

**与 §4 / §5 的关系：** §4 要求规则**声明式**表达；§2.1 要求声明与执行**物理分离**，以便 §5 Conformance 只扫 spec 层、单元测试只测 impl 层，互不污染。

**参考：** [`packages/agent/src/tools/register-defaults.ts`](packages/agent/src/tools/register-defaults.ts) · [`packages/tools/src/builtins/README.md`](packages/tools/src/builtins/README.md) · [`packages/agent/src/plugins/builtin/README.md`](packages/agent/src/plugins/builtin/README.md) · [`tests/conformance/architecture-boundaries.test.ts`](tests/conformance/architecture-boundaries.test.ts)

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

**示例（MoonTide）：**

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

**示例（MoonTide）：**

- ✅ `BASH_COMMAND_RULES` — deny / ask pattern 分组，顺序匹配
- ✅ `ToolSpec.permission` — `fixed` / `bash` / `path` 三种 kind；permission 表见 [`permission-table.ts`](packages/tools/src/permission-table.ts)；未知 tool **deny**
- ✅ `RunObserverDispatcher` + `PHASE_DEFS` — phase 名、mode、errorPolicy 一处定义
- ❌ `matchesNetworkAsk` / `matchesGrepAsk` 各写一条 `if`，或 tool 权限用 20 个 `case`

**与分层的关系：** 分层定「谁该在哪」；声明式定「在那层里怎么表达规则」——二者配合，控制复杂度随功能线性增长，而非指数增长。

---

### 5. 规范单测（Conformance）

**原则：** 凡**声明式注册表**（tool manifest、hook manifest、plugin manifest）应用单测守门；新增条目未合规则 CI / pre-commit 失败。用测试替代 runtime validator，与 §3 一致。

**范围（四类来源，均须覆盖）：**

| 来源 | 注册入口 | 规范单测关注点 |
|------|----------|----------------|
| **Builtin** | [`register-defaults.ts`](packages/agent/src/tools/register-defaults.ts) · [`builtins/<domain>/tools.ts`](packages/tools/src/builtins/README.md) | 每条 `ToolSpec` 含 `permission` 与 `capability`；name 与 `TOOL_NAMES` 一致；impl 与 spec 分层（§2.1） |
| **Extension** | 同上 manifest 的 plugin 工厂（[`code_repl`](packages/agent/src/plugins/builtin/code-repl/tools.ts)、[`deep_research`](packages/agent/src/plugins/builtin/deep-research/tools.ts)） | 与 builtin **同一套** permission / schema 规则；optional 工厂返回 null 时跳过 |
| **Hook（内置）** | [`buildDefaultObserverManifest()`](packages/agent/src/agent/run-observers/manifest.ts) | `phase` ∈ `PHASE_DEFS`；同 phase 内 `name` 唯一；`errorPolicy` 合法 |
| **Plugin（sidecar）** | [`defineSidecarPlugin`](packages/plugins-sdk/src/define.ts) · [`plugins.json`](packages/sidecar-host/src/manifest.ts) | manifest 条目 `id/kind/attach` 合法；sidecar 暴露的 hook（`listSidecarHooks`）与 tool 经 attach 后同样受检 |

**计划测试文件：**

| 文件 | 职责 |
|------|------|
| [`tests/conformance/`](tests/conformance/) | 规范单测目录；`pnpm run test:conformance` = `vitest run tests/conformance` |
| [`tests/conformance/architecture-boundaries.test.ts`](tests/conformance/architecture-boundaries.test.ts) | 结构不变量：`session/` 零 `agent/` import；`agent/`·`context/` 零 SDK；SDK 仅在 `llm/adapters`·`client` |
| [`tests/conformance/tool-permissions.test.ts`](tests/conformance/tool-permissions.test.ts) | 遍历 `registerDefaultTools()` → 每条 tool 与 `TOOL_PERMISSIONS` · `TOOL_CAPABILITIES` 表一致 |
| `tests/conformance/run-observer-manifest.test.ts` | `buildDefaultObserverManifest()` → phase / name / errorPolicy；无 `sessionItem/file` |
| `tests/conformance/plugin-manifest.test.ts` | `loadPluginManifest` / manifest 条目 schema；sidecar ready 握手与 hook·tool 列表快照（可选） |

**pre-commit：** `.husky/pre-commit` 跑 `pnpm run test:conformance`（结构边界 + hook manifest + tool permission）；全量 `pnpm test` 仍由 CI / 本地 `pnpm check` 覆盖。

**Plugin tool 命名：** sidecar 注册 tool 使用 `pluginId__toolName`（[`ToolRegistry.pluginToolName`](packages/tools/src/registry.ts)）；permission 随 `ToolDefinition` 一并声明，默认 **deny**，显式 opt-in。

**与 §6 关系：** §5 是 §6「注册表类不变量」的子集；§6 覆盖变换、行为、架构等更广的不变量。

**参考：** [`docs/notes/runtime/monorepo-packages.md`](docs/notes/runtime/monorepo-packages.md) · [`docs/notes/runtime/architecture-remediation.md`](docs/notes/runtime/architecture-remediation.md) · [`docs/notes/runtime/plugin-host.md`](docs/notes/runtime/plugin-host.md)（sidecar-host 实现）· [`docs/notes/runtime/agent-run-hooks.md`](docs/notes/runtime/agent-run-hooks.md)

---

### 6. 不变量与契约测试（Invariants & Contracts）

**原则：** 开发者脑中的「运行时应该长什么样」——数据结构、模块边界、派生规则、hook 语义——应写成**可失败的不变量测试**，而不是只靠 code review 或 scattered runtime assert。测试即**可执行的契约**。

**业界对应（可检索）：**

| 术语 | 含义 | MoonTide 落点 |
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
| **集成状态** | 一次 run 后跨模块状态一致 | 端到端 + 读 log/event 快照 | [`tests/log-sync.test.ts`](tests/log-sync.test.ts)（RunEvent derive）· [`tests/run-storage.test.ts`](tests/run-storage.test.ts) |
| **事件形状** | 派生 event 字段、seq、channel | schema / 快照断言 | [`tests/events-schema.test.ts`](tests/events-schema.test.ts) |

**配套做法：**

- **先写不变量，再写实现** — 新 pipeline（如 Item→Message、compose、derive）先列「哪些输入/状态下必须成立什么」，每条对应至少一个测试名能读懂的 `it(...)`。
- **不变量优先于覆盖率** — 一条清晰的「Session 零 agent 依赖」胜过百行未断言的集成跑通。
- **测试替身打在 port，不打在叶子** — mock `getLLMProvider` / commit port，不 mock 半条 transform 链；与 §1 边界一致。
- **用测试代替 runtime validator** — 与 §3 一致：compile-time / CI 能守住的 shape，不在热路径加 `assert`；不可信输入（用户文件、sidecar JSON）另议。
- **文档里的 Spec = 测试的索引** — Spec 写「应然」；不变量测试写「仍然」；二者不一致时以测试失败驱动修 Spec 或修代码。

**判据：** 改完模块后能否回答——**(1) 哪条不变量可能被破坏？(2) 现有哪条测试会红？(3) 若没有，是否该补？** 若三项都答不出，说明契约未显式化。

**示例（MoonTide）：**

- ✅ `log-to-messages` — tool_use 后 tool_outcome 必须合并为带 `tool_result` 的 user message
- ✅ `hooks-order` — 某 handler throw 时同 phase 后续 handler 仍执行（`errorPolicy: observe`）
- ✅ `log-sync.test` — 一次 run 只 derive 一条 `user_prompt`，tool 轮不重复 trace（RunEvent 路径）
- ❌ 只在 PR 描述写「Session 不依赖 Harness」，无 [`session-ports.test.ts`](tests/session-ports.test.ts) 类门禁
- ❌ 为 `toMessageParams` 加 runtime typeof 检查 — compose / transform 已有 oracle 测试即可

**参考：** Meyer, *Object-Oriented Software Construction*（Design by Contract）· Ford et al., *Building Evolutionary Architectures*（Fitness Functions）· [`docs/spec/context-composer.md`](docs/spec/context-composer.md) §1.4 术语与 materialize/compile/derive 边界

---

### 7. 术语（一词一义）

#### 7.1 Session / Context（产品层）

完整表见 [`docs/spec/context-composer.md` §1.4](docs/spec/context-composer.md#14-术语一词一义)：

| 过程 | 用词 | 代码 |
|------|------|------|
| Item Log → `SessionMessage[]` | **materialize / 还原** | `messagesFromItems` · `applyItemToMessages` |
| Session → `LLMRequest` | **compile / 编译** | `composeContext` |
| RunEvent → Agent Event | **derive / 派生** | `packages/agent/src/log/run-event-derive.ts` · `createRunEventDeriveListener` |

文档与讨论中**避免**用「投影 / Projection」指上述过程。

**说明：** Legacy `sessionItem` → `log-sync` 已删除；Agent Event 由 RunEvent bus 订阅派生（M6）。

#### 7.2 Agent-core / Run（内核层）

设计 Spec：[`docs/spec/agent-core.md`](docs/spec/agent-core.md) · 开发计划：[`docs/notes/runtime/agent-core-roadmap.md`](docs/notes/runtime/agent-core-roadmap.md)

| 术语 | 含义 | 包 / 模块 |
|------|------|-----------|
| **Temporal core / 时序内核** | 唯一决定 run 下一步：`runLoop` + compositor | `@moontide/agent-core` |
| **RunEvent** | run 内语义事件 union（`run_start`、`turn_start`、`message_update`…） | `@moontide/run-protocol` → `protocol/` |
| **RunEvent protocol** | run-protocol 包内共享契约（类型 + Effect 端口签名） | `packages/run-protocol/src/protocol/` |
| **Semantic event** | 持久化/策略用完整事件（message/tool start/end） | RunEvent 子集 |
| **Rendering event** | 仅 `message_update`（流式 delta）；不进 Session Item Log | RunEvent |
| **RunEvent bus** | 进程内 RunEvent pub/sub 门面；loop **publish**，订阅者与 EventOutput **subscribe** | `agent-core`（实现）；文档不用 sink |
| **RunConfig** | run 开始前冻结的策略对象（决策回调 + transform/convert） | `@moontide/run-protocol` |
| **resolveRunConfig** | run 前从 Preset / 内置 / extension adapter **合并并 freeze** RunConfig | `agent-core` |
| **resolveTurnContext** | 每 turn、每次 LLM 前：`transformContext` → `convertToLlm` | `agent-core` |
| **Hook composition** | resolveRunConfig 内 first / waterfall / blockable 组合语义 | 实现细节；文档主词用 resolveRunConfig |
| **Decision callback** | RunConfig 槽（如 `beforeToolCall`）；只返回决策 | 非 HookPhase 注册表 |
| **Effect port** | `StreamFn`、`ToolExecutor` 注入边界 | `@moontide/run-protocol` |
| **Extension adapter** | sidecar 在 run 前 fold 进 RunConfig 的适配层；**不得** publish RunEvent | `@moontide/sidecar-host` + packages/agent-cli 装配 |
| **RunObserverRegistry** | Harness 侧 run 前 sidecar observer 注册表（非 agent-core）；run 内不可增删 | `@moontide/agent` · `run-observers/` |

**硬边界：**

| | **resolveTurnContext**（core） | **composeContext**（产品） |
|---|-------------------------------|----------------------------|
| 输入 | 内存 `AgentMessage[]` | Session + stores + Instruction State |
| 输出 | LLM `Message[]` | `LLMRequest` + Context Manifest |
| 职责 | transform + convert | checkpoint、compaction、budget、manifest |

**扩展约束（不可违反）：**

- 插件 **不能定义 lifecycle phase**；阶段名只存在于 RunEvent union（协议版本 bump，非 runtime 注册）。
- 观测：**subscribe(RunEvent)**；决策：**RunConfig decision callback**。
- Sidecar：**tools** + resolveRunConfig 适配 + 只读 subscribe；无 `sessionItem` observe emit。

#### 7.3 弃用表述（迁移期）

| 避免 | 改用 |
|------|------|
| sink | **RunEvent bus** |
| fold（config/context） | **resolveRunConfig** / **resolveTurnContext** |
| 可注册 observer phase / observe 返回 EventDraft | **RunEvent bus** + **RunConfig** decision callback |
| channel/kind AgentEvent（run 观测） | **RunEvent** |

| Sidecar attach | sidecar 经 `RunObserverRegistry` 注册 **Harness observer phase**（run 前 freeze；非 agent-core 注册表） |

Harness 扩展：**RunConfig** 决策槽（`beforeToolCall` / `afterToolCall`）+ **RunEvent bus** subscribe + 上表 sidecar observer phase。

---

### 8. 错误边界与排查

**原则：** 每种错误有稳定 `ErrorCode`；边界处统一 `toMessage` / `toFailureOutcome`；需要人眼排查的路径走 `reportError`。

| 层 | 规则 |
|----|------|
| `define-tool` / manifest | `validationError(...)`；Conformance 单测守门 |
| Tool handler (`builtins/*`) | 预期失败 → `toolFailureMessage(toMessage(err))` 或 JSON `{ error }`；**不 throw** |
| `executeTool` | missing runtime / unknown tool → `toolError(...)` throw |
| `runTool` / `runLLM` | 唯一 catch → `toFailureOutcome` |
| Observer fail-open | `emitObserverError` → `publishAgentError`（stderr + `plugin_error` event） |
| Observer fail-closed | `RunObserverError extends MoonTideError` |
| CLI fatal | `formatCliError` + `cliExitCode` |
| REPL turn 失败 | `reportError`；REPL 继续（config fatal 除外） |

**排查三档数据源：**

1. 终端红色 **ERROR** 块（`formatErrorTerminal`，`/thinking` 以上可见）
2. `.moontide/runs/<runId>.active.jsonl` — grep `plugin_error`（Agent Event 持久化）
3. `/debug on` → `.moontide/debug/<runId>.jsonl` — 按 turn 对照 compose / llm_call / tool_use / **error**

**context 字段约定：** 网络错误带 `url`、路径错误带 `path`、sidecar 带 `pluginId`。

Tool 预期失败继续 return `"Error: ..."` 字符串协议（见 `agent/pipeline/tool-result.ts`）；debug `tool_use` 记录在 failed/denied/rejected 时附加 `errorCode`。

---

## 用户覆盖

如果用户的指令与本文档任何规则冲突，先请求显式确认再覆盖。确认后才可以执行他们的指令。
