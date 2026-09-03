---
name: batch-implement
description: MoonTide 模块分批实现：Review 批合并交付（diff 通常控制在约 2000 行内，允许有说明的例外）；可选 GitHub 模块分支 + 批 PR。Use when 模块 README + DESIGN 已确认、开始写代码或按 Review 批推进。
---

# 拆任务 · 实现 · Review · Commit

父 skill：[moontide-kernel-plan](../SKILL.md)。**Implementation 前置条件：** 对应模块短 `README.md` + crate 级 `DESIGN.md`（`agent-core` 锚点）已由用户确认落盘。若功能价值、契约或设计仍不确定，先进入 Discovery，不把探索性代码当作产品实现。

用户扮演 **产品/架构决策参与者、学习者和最终 reviewer**；开发流程分为 **Tideforge（Implementer）** 与 **Tidewatch（Reviewer）** 两个角色。Tideforge 负责实现，Tidewatch 独立检查；两者可以由不同 agent 承担，也可以在没有多 agent 能力时由同一 agent 以新的 review phase 承担，但不能把实现摘要直接当作 review 证据。用户不需要具备 agent 产品架构经验，也不承担独立证明方案正确的责任。Tideforge 和 Tidewatch 都必须依据 README、DESIGN、AGENTS、现有源码、测试和可复现证据工作；**公开 API 以 README 为准**；实现细节以 **DESIGN.md** 为准。若实现中必须改公开签名，**停批、回架构对齐**，禁止静默改 API。

每个稳定的 Implementation Review 批都采用双轨协作：除 Implementer 的实现批次外，默认必须为用户分配一个与本批直接相关的 **User Parallel Task**，让用户在 Implementer 执行期间进行代码追踪、契约理解、独立 practice 或决策准备。Discovery 可以使用 Decision / Trace 任务，也可以明确标记为不适用；不为了形式强行制造任务。User Parallel Task 不要求用户独立发现方案错误，不阻塞实现，但必须与本批共享验收标准。Implementer 必须交付实现证据，Reviewer 必须独立输出 Review Report，并把 Findings、未知项和用户需要决定的取舍分开。

**两层粒度（不要混）：**

| 层 | 作用 | 粒度 |
|----|------|------|
| **TASK** | 实现跟踪、依赖、完成标准 | 细（可 ~80 行）——**不等于一次 review** |
| **Review 批** | 用户 `git diff` 的单位 | 粗——合并多个 TASK，**目标 ~300–1500 行**，软预算约 **2000** 行 |

80 行的 scaffold **不应**单独停一轮 review；应与同层后续 TASK 合并，直到够一个可理解的心智模型（如「契约层整包」）。

**Review 预算：**

- **软预算约 2000 行** — 超过时先判断是否仍是单一语义边界；小幅超过且仍易审查可以保留，并说明原因
- **目标 300–1500 行** — 值得用户开一轮 review
- **&lt;300 行** — 默认继续合并下一 TASK（除非已是逻辑边界且下一 TASK 很大）

---

## 何时启用

- 模块 README + DESIGN 已 ☑，进入「实现 + 单测」阶段
- 用户说：继续实现 / 按 TASKS 做 / 下一批 / review 过了 commit

## 何时停止本 skill、回到父 skill

- 模块全部 TASK ☑ + PROGRESS 实现/测试 ☑ → 下一模块从「架构对齐」开始
- 用户要求改公开接口 → 回父 skill §1 架构对齐

---

## 流程总览

```text
读 README（契约）+ DESIGN（实现范围）+ PROGRESS
  → 判断模式：Discovery / Implementation / Replan
  → 生成/更新 Work Packet
  → Discovery：调研 / 追踪 / 最小 spike → Decision Record
  → 若契约稳定：进入 Implementation；若发现 L2/L3 变化：进入 Replan
  → Implementation：创建/更新 GitHub Issue 和 Review 批；Replan 后从更新范围重新拆分
  → 向用户展示：TASK / Decision Record + **User Parallel Task** + Shared Acceptance
  → Tideforge 按 **Review 批** 实现（一批可含多个 TASK）
  → Tideforge 交付 Implementation Evidence；用户并行完成 User Parallel Task
  → Tidewatch 读取 Work Packet、live source、diff 和验证结果，交付 Review Report
  → git diff --shortstat：>2000 评估可审查性并说明保留/拆批理由；<300 且还能合并 → 考虑继续下一 TASK 再一起交 review
  → 停等用户 review → commit → 下一 Review 批
```

**硬门禁：** 每批实现后 **必须停等 review**；**未经用户说 commit 不得 commit**。

Discovery 和 Replan 不要求按 Review 批大小停顿，也不要求先创建完整 Issue 列表；它们的目标是产生足够证据和明确决策。进入 Implementation 后，恢复 Review 批、Work Packet、验证和用户 review 门禁。

---

## Step 0：建立 Work Packet

Work Packet 是本批的最小上下文，不是完整聊天记录，也不是对历史结论的盲目信任。Tideforge 和 Tidewatch 都必须以当前 checkout、canonical docs 和实际验证结果重新确认关键事实。

Work Packet 至少包含：

```markdown
## Work Packet: {module} R{n}

- **Base:** branch / commit / worktree 状态
- **Mode:** Discovery / Implementation / Replan
- **Goal:** 本批交付与版本目标
- **Current hypothesis:** 当前对需求、设计或实现的假设
- **Source of truth:** README、DESIGN、AGENTS、相关测试和当前实现
- **Confirmed decisions:** 已确认的边界、所有权、生命周期和错误语义
- **Open questions:** 尚未解决的问题
- **Evidence:** 调研、代码追踪、spike 或测试证据
- **Scope:** 本批允许修改的路径与 concern
- **Non-goals:** 本批明确不做的事项
- **Agent Task:** Tideforge 的实现清单
- **Reviewer:** Tidewatch
- **User Parallel Task:** 用户等待期间的任务
- **Shared Acceptance:** 双方共同汇合的验收标准
- **Decision changes:** 本批新发现导致的设计或范围变化
- **Next smallest experiment:** 下一步最小证据动作
- **Stop conditions:** 必须暂停并请求用户决定的情况
```

Work Packet 是可更新、可版本化的假设和证据记录，不是一次生成后冻结的计划。它的职责是减少重复上下文读取，不是减少事实核验。Reviewer 至少重新检查 canonical docs、变更文件、tracked/untracked 状态和验证命令；历史摘要不能替代 live source。

### 角色输入与输出

| 角色 | 输入 | 输出 | 权限边界 |
|---|---|---|---|
| **Tideforge** (`implementer`) | Work Packet、README、DESIGN、live source、tests | 代码/文档变更、测试结果、Implementation Evidence | 只改 scoped 路径；不改公开契约和架构决策 |
| **Tidewatch** (`reviewer`) | Work Packet、live source、当前 diff、Implementation Evidence | Review Report、Standards / Spec findings、未知项 | 默认只读；不替 Tideforge 修复 |
| **User** | Work Packet、Review Report、User Parallel Task 产出 | 架构/范围决定、diff review、commit 授权 | 不承担独立证明正确性 |

### Implementation Evidence

Tideforge 完成后必须记录：

- changed files 和 diff 规模；
- focused tests、workspace checks 和环境阻塞；
- README/DESIGN/GitHub Issues/PROGRESS 是否同步；
- 已知风险、未验证假设和未完成项。

### Review Report

Tidewatch 必须按以下结构交付：

```markdown
## Review Report: {module} R{n}

### Standards Findings
- [P?] 路径:位置 — 规范、工程纪律或文档同步问题

### Spec Findings
- [P?] 路径:位置 — 契约、所有权、生命周期、错误语义或行为问题

### Verified
- 已检查的文件、命令和结果

### Unknown / Blocked
- 无法验证的事实及原因

### Recommendation
- pass / fix required / return to architecture alignment
```

Tidewatch 发现公开 API、所有权、生命周期、错误语义或范围必须改变时，停止本批并回到父 skill 的架构对齐阶段。

---

## Discovery 与 Replan

### Discovery

Discovery 用于回答“这个功能是否应该存在”“哪种设计更合理”或“当前实现暴露了什么新约束”。它可以先于 README/DESIGN 定稿，但只能进行有限、可丢弃或可明确标记为实验性的工作：

- 读取 live source、规范和现有测试；
- 做最小代码 spike、行为复现或公开证据调研；
- 比较选项、记录未知项和验证成本；
- 输出 Decision Record，说明继续、缩小、改变方向或放弃。

Discovery 不得直接把未经确认的假设扩散到多个模块，也不得借探索之名顺手实现无关功能。若 spike 产生了必须保留的代码，先把它纳入明确的 Implementation scope，并回到 README/DESIGN 对齐。

### Replan

当 Tideforge 在 Implementation 中发现设计需要变化时，先判断影响等级：

| 等级 | 示例 | 处理 |
|---|---|---|
| **L0** | 函数内部算法、测试组织、局部私有重构 | Tideforge 继续并在 Evidence 中记录 |
| **L1** | 模块内部私有结构、局部错误策略、测试不变量 | Tideforge 提议，Tidewatch 检查，更新 DESIGN/Work Packet |
| **L2** | 公开 API、模块所有权、依赖方向、持久化格式 | 停批，回父 skill 架构对齐，用户确认后继续 |
| **L3** | 功能是否存在、版本范围、用户体验、产品优先级 | 停批，请用户做产品决策 |

Replan 交付至少包含：

```markdown
### Decision Record
- **发现：** 实现或证据暴露了什么
- **影响等级：** L0 / L1 / L2 / L3
- **原假设：**
- **新证据：**
- **选项：**
- **决定：**
- **取舍与后果：**
- **更新文件：** Work Packet / README / DESIGN / GitHub Issues / PROGRESS
```

Replan 完成后，不强行沿用旧 TASK；应从更新后的 Work Packet 和 source of truth 重新拆最小可交付切片。

---

## Step 1：拆任务（GitHub Issue）

从 crate 级 **DESIGN.md** 拆成 **细 TASK**（实现步），公开 API 对照 **README.md**，再规划 **Review 批**（合并表）。每个 Review 批或 TASK 对应一个 GitHub Issue（标签如 `kernel`、`review-batch`）。

**不再**在 `crates/**/TASKS.md` 落盘；Issue body 须含：**做什么 / 依赖 / 范围 / 完成标准**。

**TASK：** 单一 concern、依赖清晰、预估 ≤800 行（便于合并）

**Review 批合并规则：**

| 条件 | 做法 |
|------|------|
| 多个小 TASK 同层（如 01+02+03 契约层） | 合并为一 Review 批 |
| 单 TASK 预估 ≥500 行 | 可单独成 Review 批（如 adapter 联调） |
| 合并后 &lt;300 行 | 继续并下一 TASK，除非已无依赖后继 |
| 合并后 &gt;2000 行 | 优先拆批；若仍是单一语义边界且超出有限，可说明原因后保留 |
| 心智模型 | 一批 = 用户能用一个主题概括（「normalize 层」「adapter 层」） |

Issue（或 PR 描述中的 Review 批表）须含：**Review 批总览**（用户主要看）+ **TASK 明细**（跟踪用）。

**拆完 Issue 后、写代码前：** 在对话里用简短表格说明各 TASK「要做什么」，并同时给出一个 User Parallel Task 和 Shared Acceptance；用户确认本批后再实现。

### TASK 条目模板

每个 TASK **说清这次要做什么**即可——让用户 review diff 时能建立心智模型；不写实现细节、不写长篇 Review 清单。

```markdown
### TASK-{mod}-{nn}: {标题}

- **做什么：** 1–3 句话——本步目标、在模块里的位置、完成后多出什么
- **依赖：** TASK-… 或 无
- **范围：** 主要改哪些路径
- **预估 diff：** ~NNN 行
- **完成标准：** 一条可执行命令或判定
- **状态：** ☐ / ☑
```

| 字段 | 要求 |
|------|------|
| **做什么** | 必填。回答「这一步为什么存在、review 时我该当什么看」 |
| 范围 | 路径列表，一行即可 |
| 其余 | 能短则短 |

**禁止：** 不碰 / 交付 / Review 关注 等冗长小节（除非用户明确要求）。

### 拆分汇报模板（对话里发送）

```markdown
## {mod} 拆分

### Review 批（你要 review 的单位）
| 批 | TASK | 主题 | 预估 |
| R1 | 01–03 | 契约层 | ~630 |

### TASK 明细（12 步，实现跟踪）
| TASK | 做什么 | 预估 |
…

确认 OK 后从 Review 批 R1 开始。
```

### User Parallel Task

每个 Review 批默认分配一个用户任务，目标是让用户在等待期间获得可验证的项目掌控或代码实践，而不是重复 Agent 的实现工作。它是学习与协作输入，不是把技术正确性审查外包给用户。

任务类型从以下四类中选择最贴近本批的一类：

| 类型 | 适用场景 | 典型产出 |
|---|---|---|
| **Trace** | 新模块、跨层调用、状态流 | 调用链、所有权表、状态流说明 |
| **Review** | 理解契约、错误路径、文档同步 | 疑问、验收问题、风险清单；不要求用户独立证明正确 |
| **Practice** | 用户希望上手改代码 | 独立测试、小范围修改、复现记录 |
| **Decision** | 存在未决边界或取舍 | 基于证据的决策建议 |

User Parallel Task 必须包含：

```markdown
### User Parallel Task
- **类型：** Trace / Review / Practice / Decision
- **目标：** 用户需要理解、检查或完成什么
- **范围：** 文件、模块或调用路径
- **时间：** 15–60 分钟
- **产出：** 表格、说明、测试、diff 或决策记录
- **完成标准：** 可执行的检查方式
- **与 Agent 的边界：** 不修改 Agent 正在使用的同一文件；如需代码修改，先指定不冲突路径或独立工作区
```

User Parallel Task 的选择规则：

- 优先服务当前版本和当前 Review 批，不提前研究无真实消费者的未来能力。
- 任务应能在 Agent 执行期间独立完成，不等待 Agent 的中间结果。
- 用户完成后应能解释至少一个 owner、数据流、失败语义或验收不变量；解释困难本身是 Agent 需要补充说明或修正教学任务的信号。
- 不把“阅读全部代码”“泛化学习”或“继续思考架构”作为完成标准。

### Shared Acceptance

本批必须给出一组同时约束 Agent Task 和 User Parallel Task 的验收标准。Shared Acceptance 不是要求用户单独认证正确性；Agent 必须额外完成独立的技术自审，例如：

```markdown
### Shared Acceptance
- README 公开 API 与实现一致
- 用户能说明 Session Item Log 到当前调用者的事实流
- focused test 覆盖成功、失败和取消路径
- `just check` 或明确的环境阻塞证据已记录
- Agent 已检查 Standards、Spec、边界错误、未跟踪文件和文档状态，并披露未验证假设
```

### 拆分原则

| 原则 | 说明 |
|------|------|
| **Review 预算** | 拆 TASK 时按约 2000 行软预算反推；大文件（adapter 联调）优先单独成 TASK |
| 先契约后 IO | `protocol` → `provider` → `normalize` → `adapter` |
| 先骨架后联调 | enum/stub 可先落地，HTTP 联调单独 TASK |
| 测试跟行为 | 单测跟对应 TASK 走，避免末尾一个 TASK 塞满千行测试 |
| 不改公开 API | 与 README 冲突时停批 |
| 逻辑子模块可整批 | 如整个 `protocol/` 若预估 ≤800 行，可单独 1 TASK；合并多 TASK 时以约 2000 行为软目标 |

### 典型 TASK 粒度（参考）

| 预估 diff | 示例 |
|-----------|------|
| ~50–150 | crate scaffold、enum/stub |
| ~200–500 | 单层 protocol、单个 normalize concern（tool/thinking/stream） |
| ~500–800 | 完整 `adapter/openai_chat`（含测试）— **单独一批，不与其它 TASK 合并** |
| >800 | **必须再拆**（如 adapter 与 normalize 分离） |

首版 llm 参考顺序见 [llm-TASKS.example.md](llm-TASKS.example.md)（**deprecated**；现改为 GitHub Issue body 模板）。

---

## Step 2：Review 批大小

| 默认 | 合并规则 |
|------|----------|
| 按 Issue / Review 批表执行 | 用户可说「R1 拆成两次」或「R2 和 R3 合并」 |

**开写前：** 确认本 **Review 批** 含哪些 TASK + 主题一句话 + 预估行数。

**写完后：**

```bash
git diff --shortstat
```

| 合计行数 | 做法 |
|----------|------|
| &gt;2000 | 评估是否混入多个 concern；难审查则拆批，单一边界且仅小幅超出则说明原因后交 review |
| 300–2000 | 交 review |
| &lt;300 | 若还有同主题 TASK 未做 → **继续实现再一起 review**；否则可交（仅剩尾批时） |

一批 review 完成后停等；commit 后再开下一 **Review 批**（不是下一 TASK）。

---

## Step 3：实现纪律

- **范围：** 只改本批 TASK 声明的路径；不顺手重构无关代码
- **契约：** 不增删改 README 中的 `pub` 类型 / trait 方法，除非用户在本批前已改 README
- **旧 draft：** 不 import `crates/moontide-*` 旧实现（父 skill 铁律）
- **检查：** 代码变更后跑 `just check`；仅文档批可跳过
- **crate：** 若 `agent-core` 尚未入 workspace，本模块第一批 TASK 含 scaffold（Cargo.toml + workspace member）

---

## Step 4：Tidewatch 检查与用户 Review（每批必做）

Tideforge 完成实现、验证和自检后，**停止写代码**。先由 Tidewatch 读取 Work Packet、live source、当前 diff 和 Implementation Evidence，完成 Review Report；再把实现证据和 Review Report 一起交给用户 review：

```markdown
## 本批完成：Review 批 R{n}（TASK {mod}-01–03）

### 主题
契约层：scaffold + protocol + provider

### User Parallel Task
- **状态：** {完成 / 未完成 / 不适用}
- **产出：** {链接、说明或测试结果}

### Implementation Evidence
- **changed files：** {列表}
- **验证：** {focused tests / `just check` / 环境阻塞}
- **文档状态：** {README / DESIGN / GitHub Issues / PROGRESS}
- **未验证假设：** {列表或无}

### Tidewatch Review Report
- **Standards Findings：** {P?、路径、证据或无}
- **Spec Findings：** {P?、路径、证据或无}
- **Verified：** {检查范围与结果}
- **Unknown / Blocked：** {列表或无}
- **Recommendation：** {pass / fix required / return to architecture alignment}

### Diff 规模
- `git diff --shortstat`：{N} insertions, {M} deletions → **合计 {N+M} 行**（软预算约 2000；超出时说明原因）

### 变更摘要
- …

### Review 命令
git status
git diff --stat
git diff

### 建议关注
- 公开 API 是否仍与 **README** 一致
- 依赖方向是否违反 **DESIGN** import 边界
- Tideforge / Tidewatch 已发现的风险、反例和未验证假设
- 用户在理解过程中遇到的疑问；疑问不自动视为用户 review 失败
- …

请 review diff。通过则回复「commit」或「commit：{说明}」；要改请直接说。
```

**不要**在本消息里主动 commit 或开下一批 TASK。

---

## Step 5：Commit（仅用户触发）

用户说 **commit** 后：

1. `git status` + `git diff` 确认仅本会话/本批文件
2. `git add <显式路径>` — **禁止** `git add -A`
3. 提交信息：`{feat,fix,docs}[(scope)]: …`（scope 如 `agent-core/llm`）
4. `git status` 验证
5. 勾选本 Review 批内所有 TASK；必要时更新 [PROGRESS.md](../PROGRESS.md)

用户只 say「通过」未 say commit → 询问是否现在 commit。

---

## Step 5b：GitHub 分支与 PR（需求集成线 + Review 批 PR）

本地 `git diff` review 与 **GitHub PR review** 可并存：实现仍按 Review 批停等；通过后 commit → push → 开 PR，在 GitHub 上做正式 review / merge。

### 分支命名

以一个完整需求作为分支命名空间，`<demand>` 使用小写 kebab-case，例如 `assistant-host`、`project-settings`：

```text
feat/<demand>/base       # 需求集成线，最终合入 main
feat/<demand>/r1         # Review 批 R1
feat/<demand>/r2         # Review 批 R2，依赖 r1
release/<demand>-v1.0    # 可选：进入发布冻结后的稳定化分支
```

`feat/<demand>-v1.0` 不作为常规开发分支；版本号表达发布生命周期，应使用 `release/` 命名空间。没有发布冻结需求时，不创建 release 分支。

### 分支模型（`feat/{demand}/base` + stacked `feat/{demand}/r{n}`）

Git **不能**同时存在分支 `feat/assistant-host` 与 `feat/assistant-host/base`（ref 路径冲突）。需求集成线必须是 **`feat/<demand>/base`**，不能省略 `/base`。

**若已误建 `feat/<demand>`：** 用 **rename**，不要直接创建同名的 `/base` 子分支：

```bash
git branch -m feat/<demand> feat/<demand>/base
# 远程若已有旧名：push 新名后删旧 remote branch
git push -u origin feat/<demand>/base
git push origin --delete feat/<demand>   # 确认无人依赖后再删
```

**模式 B（默认）：stacked PR — 开发与 review 并行**

Review 批在 git 上**串行依赖**（R2 基于 R1 commit），但 **PR review 可并行**：R{n} 的 PR 目标为 **R{n−1}**，diff 仅含本批增量；R1 仍 PR 回 `base`。

```text
main
 └── feat/<demand>/base
       └── r1 ──PR#1──► base        （review 中）
             └── r2 ──PR#2──► r1     （开发 + review 可并行）
                   └── r3 ──PR#3──► r2
需求完成后：feat/<demand>/base → main
```

| 分支 | 从哪切 | PR 目标 | 说明 |
|------|--------|---------|------|
| **需求集成** | `main` | `main`（需求完成时） | `feat/{demand}/base` |
| **R1** | `base` | **`base`** | 首批 |
| **R{n}（n≥2）** | **`r{n−1}`** | **`r{n−1}`** | stacked；不等待 R{n−1} merge 即可切分支开发 |

GitHub 上同需求分支会归组显示；**Review 批 = 一次 PR**，不为每个细 TASK 开分支。

**R{n−1} merge 进 `base` 后（R{n} 栈整理，必做）：**

```bash
git fetch origin
git switch feat/<demand>/r2
git rebase origin/feat/<demand>/base
git push --force-with-lease
gh pr edit <r2-pr-number> --base feat/<demand>/base
```

- **合并顺序**：必须先 merge R{n−1}，再 merge R{n}（GitHub 会提示 blocked 直到 base PR 合并）
- **R{n−1} 有 review fix**：在 `r{n−1}` 上 amend/追加 commit 后，`r{n}` 执行 `git rebase r{n−1}`（或 rebase 到更新后的 `origin/r{n−1}`）
- push rebase 结果一律用 **`--force-with-lease`**

### 需求开始时（一次性）

```bash
git switch main
git pull --ff-only
git switch -c feat/<demand>/base
git push -u origin feat/<demand>/base
```

不得直接在 `main` 上实现需求。需求分支创建后，所有实现、review 修复和批次提交都在需求命名空间内完成。

### Review 批 R1（首批）

```bash
git switch feat/<demand>/base
git pull --ff-only
git switch -c feat/<demand>/r1
# … 实现 + just check …
git add <paths>
git commit -m "feat(<demand>): R1 <topic>"
git push -u origin feat/<demand>/r1
gh pr create --base feat/<demand>/base --title "feat(<demand>): R1 <topic>" --body "$(cat <<'EOF'
## 做什么
契约层：crate + protocol + provider（TASK 01–03）

## Test plan
- [ ] cargo test -p agent-core

EOF
)"
```

### Review 批 R{n}（n≥2，stacked）

**不必等 R{n−1} merge**；R{n−1} 已 commit/push 即可切分支继续开发：

```bash
git fetch origin
git switch feat/<demand>/r1
git pull --ff-only
git switch -c feat/<demand>/r2
# … 实现 + just check …
git add <paths>
git commit -m "feat(<demand>): R2 <topic>"
git push -u origin feat/<demand>/r2
gh pr create --base feat/<demand>/r1 --title "feat(<demand>): R2 <topic>" --body "$(cat <<'EOF'
## 做什么
normalize 层（TASK 04–08）

## Test plan
- [ ] cargo test -p agent-core

EOF
)"
```

R1 merge 进 `base` 后，按上文 **栈整理** 把 R2 PR 改 base 为 `base` 并 rebase。

### 需求完成时

```bash
gh pr create --base main --head feat/<demand>/base --title "feat(<demand>): complete"
```

需求 PR 合入 `main` 后，如需发布冻结再从 `main` 创建 `release/<demand>-v1.0`。发布分支只接收稳定性修复和发布元数据，不承载新的需求开发。

### Agent 纪律

- **未经用户说 push / 开 PR，不 push、不 `gh pr create`**
- PR **base**：R1 → `base`；R{n≥2} → **`r{n−1}`**（stacked）；R{n−1} merge 后 R{n} 改 base 为 `base` 并 rebase。需求集成 PR：`feat/<demand>/base` → `main`
- PR body 写 **Review 批主题 + TASK 编号**，附 Test plan
- 多 agent 并行：每人用独立批分支，避免同批分支冲突

### 与本地 review 的关系

| 步骤 | 本地 | GitHub |
|------|------|--------|
| 实现完 | 停等，`git diff` | — |
| 用户通过 | commit | push + 开 PR（用户说 push 时） |
| Review | 可读本地 diff | PR Files changed |
| 合并 | — | 按序 merge stacked PR；R{n−1} 进 `base` 后整理 R{n} 栈；需求完成后 `base` PR → `main` |

---

## Step 6：需求/模块收尾

全部 TASK ☑ 且 `just check` 全绿：

1. PROGRESS.md：该模块 **实现 ☑ · 测试 ☑**
2. `agent-core/README.md` checklist 同步
3. 告知用户：本模块完成，下一模块需先 **架构对齐**（父 skill §1）

---

## 与 Git 纪律对齐（AGENTS.md）

- 只提交本会话改动的文件
- 禁止：`git reset --hard`、`git add -A`、force push、未经要求的 amend
- 多 agent 并行：不碰其他会话未暂存文件

---

## Agent 自检清单（每批）

**拆任务阶段：**
- [ ] 已建立 Work Packet，包含 base、source of truth、scope、non-goals、stop conditions 和 Shared Acceptance
- [ ] 每个 TASK 有清晰的 **做什么**（1–3 句）
- [ ] 已在对话发送简短拆分表，用户确认后再写代码
- [ ] 已分配一个有范围、时间、产出和完成标准的 User Parallel Task
- [ ] 已定义 Agent Task 与 User Parallel Task 共用的 Shared Acceptance

**实现阶段：**
- [ ] 本批 scope 与 TASK 一致
- [ ] 未静默改 README 公开签名
- [ ] `just check` 通过（若改了代码）
- [ ] `git diff --shortstat` 已评估可审查性；超过约 2000 行时已拆批或记录保留原因
- [ ] 已完成 Agent 自检：`git status --short`、tracked/untracked diff、文档同步和错误路径
- [ ] Tideforge 已独立完成 Standards / Spec / 反例 / 错误路径自检，并明确区分 confirmed、inferred、unknown
- [ ] Tidewatch 已读取 live source、当前 diff 和 Implementation Evidence，并输出 Review Report
- [ ] User Parallel Task 已完成，或已记录未完成原因及其对验收的影响
- [ ] Implementation Evidence 与 Review Report 已写入本批交付摘要
- [ ] 汇报中含 diff 行数
- [ ] 已停等 review，未自动 commit
- [ ] 未自动开始下一批
