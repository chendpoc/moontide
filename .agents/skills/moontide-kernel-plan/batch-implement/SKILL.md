---
name: batch-implement
description: MoonTide 模块分批实现：Review 批合并交付（diff ≤2000 行）；可选 GitHub 模块分支 + 批 PR。Use when 模块 README 已确认、开始写代码或按 Review 批推进。
---

# 拆任务 · 实现 · Review · Commit

父 skill：[moontide-kernel-plan](../SKILL.md)。**前置条件：** 对应模块 `src/{mod}/README.md` 已由用户确认落盘。

用户扮演 **架构师 + reviewer**；Agent 扮演 **implementer**。公开签名以 README 为准；若实现中必须改契约，**停批、回架构对齐**，禁止静默改 API。

**两层粒度（不要混）：**

| 层 | 作用 | 粒度 |
|----|------|------|
| **TASK** | 实现跟踪、依赖、完成标准 | 细（可 ~80 行）——**不等于一次 review** |
| **Review 批** | 用户 `git diff` 的单位 | 粗——合并多个 TASK，**目标 ~300–1500 行**，上限 **2000** |

80 行的 scaffold **不应**单独停一轮 review；应与同层后续 TASK 合并，直到够一个可理解的心智模型（如「契约层整包」）。

**Review 预算：**

- **上限 2000 行** — 超过必须拆 Review 批
- **目标 300–1500 行** — 值得用户开一轮 review
- **&lt;300 行** — 默认继续合并下一 TASK（除非已是逻辑边界且下一 TASK 很大）

---

## 何时启用

- 模块 README 已 ☑，进入「实现 + 单测」阶段
- 用户说：继续实现 / 按 TASKS 做 / 下一批 / review 过了 commit

## 何时停止本 skill、回到父 skill

- 模块全部 TASK ☑ + PROGRESS 实现/测试 ☑ → 下一模块从「架构对齐」开始
- 用户要求改公开接口 → 回父 skill §1 架构对齐

---

## 流程总览

```text
读 README + PROGRESS
  → 生成/更新 src/{mod}/TASKS.md（细 TASK + **Review 批** 合并表）
  → 向用户展示：TASK 列表 + **Review 批怎么合并**
  → 按 **Review 批** 实现（一批可含多个 TASK）
  → just check
  → git diff --shortstat：>2000 拆批；<300 且还能合并 → 考虑继续下一 TASK 再一起交 review
  → 停等 review → commit → 下一 Review 批
```

**硬门禁：** 每批实现后 **必须停等 review**；**未经用户说 commit 不得 commit**。

---

## Step 1：拆任务（TASKS.md）

路径：`crates/agent-core/src/{mod}/TASKS.md`

从 README 拆成 **细 TASK**（实现步），再规划 **Review 批**（合并表）：

**TASK：** 单一 concern、依赖清晰、预估 ≤800 行（便于合并）

**Review 批合并规则：**

| 条件 | 做法 |
|------|------|
| 多个小 TASK 同层（如 01+02+03 契约层） | 合并为一 Review 批 |
| 单 TASK 预估 ≥500 行 | 可单独成 Review 批（如 adapter 联调） |
| 合并后 &lt;300 行 | 继续并下一 TASK，除非已无依赖后继 |
| 合并后 &gt;2000 行 | 拆 Review 批 |
| 心智模型 | 一批 = 用户能用一个主题概括（「normalize 层」「adapter 层」） |

TASKS.md 须含两个表：**Review 批总览**（用户主要看）+ **TASK 明细**（跟踪用）。

**拆完 TASKS.md 后、写代码前：** 在对话里用简短表格说明各 TASK「要做什么」，用户确认后再实现。

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

### 拆分原则

| 原则 | 说明 |
|------|------|
| **Review 预算** | 拆 TASK 时按 2000 行上限反推；大文件（adapter 联调）单独成 TASK |
| 先契约后 IO | `protocol` → `provider` → `normalize` → `adapter` |
| 先骨架后联调 | enum/stub 可先落地，HTTP 联调单独 TASK |
| 测试跟行为 | 单测跟对应 TASK 走，避免末尾一个 TASK 塞满千行测试 |
| 不改公开 API | 与 README 冲突时停批 |
| 逻辑子模块可整批 | 如整个 `protocol/` 若预估 ≤800 行，可单独 1 TASK；合并多 TASK 时合计 ≤2000 |

### 典型 TASK 粒度（参考）

| 预估 diff | 示例 |
|-----------|------|
| ~50–150 | crate scaffold、enum/stub |
| ~200–500 | 单层 protocol、单个 normalize concern（tool/thinking/stream） |
| ~500–800 | 完整 `adapter/openai_chat`（含测试）— **单独一批，不与其它 TASK 合并** |
| >800 | **必须再拆**（如 adapter 与 normalize 分离） |

首版 llm 参考顺序见 [llm-TASKS.example.md](llm-TASKS.example.md)（可复制到 `src/llm/TASKS.md` 再微调）。

---

## Step 2：Review 批大小

| 默认 | 合并规则 |
|------|----------|
| 按 TASKS.md **Review 批**表执行 | 用户可说「R1 拆成两次」或「R2 和 R3 合并」 |

**开写前：** 确认本 **Review 批** 含哪些 TASK + 主题一句话 + 预估行数。

**写完后：**

```bash
git diff --shortstat
```

| 合计行数 | 做法 |
|----------|------|
| &gt;2000 | 拆 Review 批重做 |
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

## Step 4：停等 Review（每批必做）

实现 + `just check` 通过后，**停止写代码**，向用户汇报：

```markdown
## 本批完成：Review 批 R{n}（TASK {mod}-01–03）

### 主题
契约层：scaffold + protocol + provider

### Diff 规模
- `git diff --shortstat`：{N} insertions, {M} deletions → **合计 {N+M} 行**（预算 ≤2000）

### 变更摘要
- …

### Review 命令
git status
git diff --stat
git diff

### 建议关注
- 公开 API 是否仍与 README 一致
- 依赖方向是否违反 README §2
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

## Step 5b：GitHub 分支与 PR（推荐，Review 批 = 一次 PR）

本地 `git diff` review 与 **GitHub PR review** 可并存：实现仍按 Review 批停等；通过后 commit → push → 开 PR，在 GitHub 上做正式 review / merge。

### 分支模型（`feat/{mod}/base` + stacked `feat/{mod}/r{n}`）

Git **不能**同时存在分支 `feat/agent-core-llm` 与 `feat/agent-core-llm/r1`（ref 路径冲突）。模块集成线必须是 **`feat/agent-core-llm/base`**，不能是 `feat/agent-core-llm`。

**若已误建 `feat/agent-core-llm`：** 用 **rename**，不要 `checkout -b feat/agent-core-llm/base`：

```bash
git branch -m feat/agent-core-llm feat/agent-core-llm/base
# 远程若已有旧名：push 新名后删旧 remote branch
git push -u origin feat/agent-core-llm/base
git push origin --delete feat/agent-core-llm   # 确认无人依赖后再删
```

**模式 B（默认）：stacked PR — 开发与 review 并行**

Review 批在 git 上**串行依赖**（R2 基于 R1 commit），但 **PR review 可并行**：R{n} 的 PR 目标为 **R{n−1}**，diff 仅含本批增量；R1 仍 PR 回 `base`。

```text
main
 └── feat/agent-core-llm/base
       └── r1 ──PR#1──► base        （review 中）
             └── r2 ──PR#2──► r1     （开发 + review 可并行）
                   └── r3 ──PR#3──► r2
模块完成后：feat/agent-core-llm/base → main
```

| 分支 | 从哪切 | PR 目标 | 说明 |
|------|--------|---------|------|
| **模块集成** | `main` | `main`（模块完成时） | `feat/{mod}/base` |
| **R1** | `base` | **`base`** | 首批 |
| **R{n}（n≥2）** | **`r{n−1}`** | **`r{n−1}`** | stacked；不等待 R{n−1} merge 即可切分支开发 |

GitHub 上同模块分支会归组显示；**Review 批 = 一次 PR**，不每个细 TASK 开分支。

**R{n−1} merge 进 `base` 后（R{n} 栈整理，必做）：**

```bash
git fetch origin
git checkout feat/agent-core-llm/r2
git rebase origin/feat/agent-core-llm/base
git push --force-with-lease
gh pr edit <r2-pr-number> --base feat/agent-core-llm/base
```

- **合并顺序**：必须先 merge R{n−1}，再 merge R{n}（GitHub 会提示 blocked 直到 base PR 合并）
- **R{n−1} 有 review fix**：在 `r{n−1}` 上 amend/追加 commit 后，`r{n}` 执行 `git rebase r{n−1}`（或 rebase 到更新后的 `origin/r{n−1}`）
- push rebase 结果一律用 **`--force-with-lease`**

### 模块开始时（一次性）

```bash
git checkout main && git pull
git checkout -b feat/agent-core-llm/base
git push -u origin feat/agent-core-llm/base
```

### Review 批 R1（首批）

```bash
git checkout feat/agent-core-llm/base && git pull
git checkout -b feat/agent-core-llm/r1
# … 实现 + just check …
git add <paths>
git commit -m "feat(agent-core/llm): R1 contract layer (TASK 01-03)"
git push -u origin feat/agent-core-llm/r1
gh pr create --base feat/agent-core-llm/base --title "feat(agent-core/llm): R1 contract layer" --body "$(cat <<'EOF'
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
git checkout feat/agent-core-llm/r1 && git pull    # 上一批分支
git checkout -b feat/agent-core-llm/r2
# … 实现 + just check …
git add <paths>
git commit -m "feat(agent-core/llm): R2 normalize layer (TASK 04-08)"
git push -u origin feat/agent-core-llm/r2
gh pr create --base feat/agent-core-llm/r1 --title "feat(agent-core/llm): R2 normalize layer" --body "$(cat <<'EOF'
## 做什么
normalize 层（TASK 04–08）

## Test plan
- [ ] cargo test -p agent-core

EOF
)"
```

R1 merge 进 `base` 后，按上文 **栈整理** 把 R2 PR 改 base 为 `base` 并 rebase。

### 模块完成时

```bash
gh pr create --base main --head feat/agent-core-llm/base --title "feat(agent-core): llm module"
```

### Agent 纪律

- **未经用户说 push / 开 PR，不 push、不 `gh pr create`**
- PR **base**：R1 → `base`；R{n≥2} → **`r{n−1}`**（stacked）；R{n−1} merge 后 R{n} 改 base 为 `base` 并 rebase。整模块 PR → `main`
- PR body 写 **Review 批主题 + TASK 编号**，附 Test plan
- 多 agent 并行：每人用独立批分支，避免同批分支冲突

### 与本地 review 的关系

| 步骤 | 本地 | GitHub |
|------|------|--------|
| 实现完 | 停等，`git diff` | — |
| 用户通过 | commit | push + 开 PR（用户说 push 时） |
| Review | 可读本地 diff | PR Files changed |
| 合并 | — | 按序 merge stacked PR；R{n−1} 进 `base` 后整理 R{n} 栈 |

---

## Step 6：模块收尾

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
- [ ] 每个 TASK 有清晰的 **做什么**（1–3 句）
- [ ] 已在对话发送简短拆分表，用户确认后再写代码

**实现阶段：**
- [ ] 本批 scope 与 TASK 一致
- [ ] 未静默改 README 公开签名
- [ ] `just check` 通过（若改了代码）
- [ ] `git diff --shortstat` 合计 **≤2000 行**（否则已拆批，未交 review）
- [ ] 汇报中含 diff 行数
- [ ] 已停等 review，未自动 commit
- [ ] 未自动开始下一批
