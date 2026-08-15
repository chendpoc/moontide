# MoonTide 迁移计划：TypeScript → Rust 多语言

> **文档性质：** notes（迁移执行计划，checklist 化，可逐步执行与勾选）
> **状态：** 已完成 —— 阶段 0–4 全部执行完毕（见文末「执行记录」）
> **关联：** [`agent-kernel-architecture.md`](agent-kernel-architecture.md)（目标架构决策）· [`runtime-multilang.md`](runtime-multilang.md)（多语言方向）

## 背景与目标

彻底摒弃 TypeScript 实现（初版 draft），迁移为多语言项目：**Rust（内核 + 推理 + CLI + UI）+ Go（后台监控/代理，后置）+ Node（扩展生态，后置）**。

- TS 代码删除，git 历史保留（回退点：`main` 分支完整 TS 快照）。
- TS 讨论/实现文档归档到 `docs/archive/`（已移 36 份）。
- 目录按职责命名：`crates/`（Rust）+ `services/`（Go）+ `node/`（Node）+ `schema/`（跨语言契约）。

---

## 阶段 0：切分支 + 归档文档（已完成）

- [x] 从 `main`（`33f000c`）切出 `rust-rewrite` 分支
- [x] `git mv` 36 份 TS 文档到 `docs/archive/`（保子目录结构：`guides/ notes/{context,evals,llm,runtime,session} spec/`）
- [x] 提交 `agent-kernel-architecture.md` 到 main（`a1e3a8f`，随分支切出）

---

## 阶段 1：更新文档索引（消除死链）（已完成）

归档后，索引文件仍引用已移动文档，须清理。

### 1.1 `docs/spec/README.md`

删除 3 行归档条目：

- `harness-eval-1.0.md`（Harness Eval 1.1 实现契约）
- `repl-terminal.md`（TypeScript CLI REPL 终端 I/O）
- `type-imports.md`（各包类型 import 决策）

### 1.2 `docs/guides/README.md`

- 删 `feature-ab-eval.md` 行
- 删末尾一段（引用 `../spec/harness-eval-1.0.md` 与 `../notes/evals/harness-eval-refactor-plan.md`）

### 1.3 `docs/notes/README.md`

| 表 | 删除条目数 | 保留 |
|---|---|---|
| Runtime | 14（agent-core-roadmap / agent-run-hooks / agent-runtime-api / architecture-remediation / plugin-host / monorepo-packages / agent-harness-cli-split / schema-package-plan / utils-infrastructure / scratchpad / logging-design / logging-implementation / repl-terminal-invariants / repl-terminal-rust-parity） | agent-runtime-product-direction / agent-kernel-architecture / ecosystem-compat / runtime-multilang / kocoro-architecture |
| Context | 10（除 `context-analysis.md`） | context-analysis |
| Session | 4（除 `session-handoff.md`） | session-handoff |
| Evals | 3（agent-eval-roadmap / harness-eval-refactor-plan / eval-release-artifact） | agent-eval-task-taxonomy / model-harness-fit |
| LLM | 1（llm-provider-backlog） | edge-local-models |

### 1.4 `docs/README.md`

- §1 目录树加 `archive/` 行（说明：TS 时代讨论与实现文档归档）
- §3 阅读路径重写：
  - 删「做 Harness Feature Eval」「修改 monorepo / Harness / CLI 结构」两条（全归档）
  - 改其余路径的归档链接为保留文档（如「修改 Agent Core」改指 `agent-kernel-architecture.md`）
- §4 归档规则补一条：「TS 时代文档见 `archive/`，不参与当前契约」
- §5 模块级文档：暂保留（引用 `packages/*/README.md`，阶段 2 删代码时一并删）

### 验收

```bash
grep -rn "agent-core-roadmap\|harness-eval-1.0\|context-window-roadmap\|feature-ab-eval\|type-imports\|repl-terminal\|monorepo-packages\|plugin-host\|architecture-remediation\|session-domain-model" \
  docs/README.md docs/spec/README.md docs/guides/README.md docs/notes/README.md
# 应无命中（archive/ 内部除外）
```

---

## 阶段 2：删除 TypeScript 代码与工具链（已完成）

> ⚠️ 删前确认 `main` 分支已保留完整 TS 快照（本地或已 push）。

### 2.1 删除目录

| 路径 | 内容 |
|---|---|
| `packages/` | 12 包 ~28k 行：agent-cli / agent-core / agent / context-composer / evals / llm / plugins-sdk / run-protocol / session / shared / sidecar-host / tools |
| `tests/` | 116 个 TS 测试 + setup.ts + conformance/ |
| `dist/` | TS 编译产物 |
| `node_modules/` | npm 依赖 |
| `.pnpm-store/` | pnpm 存储 |
| `.husky/` | git hooks（lint-staged 绑 TS） |
| `scripts/` | 仅含 `cursor-statusline.ts` |

### 2.2 删除根 TS 配置文件

`package.json` · `pnpm-workspace.yaml` · `pnpm-lock.yaml` · `tsconfig.json` · `tsconfig.dev.json` · `tsconfig.eslint.json` · `eslint.config.js` · `vitest.config.ts`

### 2.3 检查残留

```bash
find . -name "*.ts" -not -path "./node_modules/*" -not -path "./target/*"   # 应为空
find . -name "*.tsx" -not -path "./node_modules/*"                          # 应为空
```

### 验收

- 仓库无 `.ts` / `.tsx` 文件（`target/` 内 Rust 编译产物除外）
- `git status` 只显示预期删除

---

## 阶段 3：目录重构为多语言（已完成）

### 3.1 移动与新建

```text
git mv ui/ crates/moontide-ui/          # Slint sidecar 并入 Cargo workspace
mkdir schema/                           # 跨语言契约（单一真理源落点）+ README.md 说明定位
mkdir services/                         # Go 预留 + README.md（go.mod 后置，等后台服务真实需求）
mkdir node/                             # Node 预留 + README.md（pnpm workspace 后置，等扩展生态）
touch justfile                          # 统一 build/test/check 编排
```

### 3.2 更新根 `Cargo.toml`

- `members` 去掉 `"ui"`，改为 `"crates/moontide-ui"`
- 其余 crates 成员保持（`crates/moontide-*`）

### 3.3 `justfile` 骨架

```justfile
build:
    cargo build --workspace

test:
    cargo test --workspace

check:
    cargo fmt --check && cargo clippy --workspace && cargo test --workspace
```

### 验收

- `cargo build` 通过
- `just --list` 显示 build/test/check

---

## 阶段 4：更新 README / TODO / AGENTS（已完成）

### 4.1 `README.md`

- 去掉「TypeScript harness」定位，改「Rust 内核 + 多语言（Go 后台 / Node 扩展）」
- 项目结构图更新为多语言布局

### 4.2 `TODO.md`

- 删 §16 / §17 / §18（TS monorepo 拆分方向）
- 新增多语言方向：内核 Rust 化（对齐 `agent-kernel-architecture.md` §7 模块清单）、schema、benchmark

### 4.3 `AGENTS.md`

- 命令更新：`pnpm run check` → `cargo check` / `just check`
- 分层描述更新：「utils/ → storage/ → 业务」TS 分层改为 Rust crate 边界（对齐 `agent-kernel-architecture.md` §6）
- 删除 TS 专属规则（如 `src/` 只提交 `.ts`）

### 4.4 `docs/README.md` §5

- 模块级文档从 `packages/*/README.md` 改为 `crates/*/README.md`

### 验收

```bash
grep -rn "pnpm\|@moontide/（TS 包）\|TypeScript harness\|typescript" README.md TODO.md AGENTS.md
# 仅历史说明可残留，活跃规则无 TS 依赖
```

---

## 提交策略（每阶段独立 commit，可独立 revert）

```text
阶段 1 收尾 → docs(archive): update doc indexes after TS doc archival
阶段 2      → chore: remove TypeScript implementation and toolchain
阶段 3      → chore: restructure to multi-language layout (rust/go/node)
阶段 4      → docs: rewrite README/TODO/AGENTS for Rust-first direction
```

---

## 风险与提醒

1. **阶段 2 是删有意功能**：`packages/` 28k 行 TS 是能跑的参考实现，删除后唯一找回途径是 `git show main:...`。删前确认 `main` 已 push 或本地保留。
2. **交叉引用死链**：保留文档（如 `agent-kernel-architecture.md`）内部引用已归档文档，路径改为 `../archive/...` 才会恢复。可在阶段 4 一并修正，或接受「archive 文档手动查找」。
3. **Go / Node 目录是预留空壳**：`services/`、`node/` 仅建 README，不做实际代码——符合「后置到真实需求」的架构决策（见 `agent-kernel-architecture.md` §12）。

---

## 执行记录

| 阶段 | commit | 计划外的处置 |
|---|---|---|
| 1 | `docs(archive): update doc indexes after TS doc archival` | `notes/README.md` 增 `migration-plan.md` 条目；四个索引各补一句 archive 说明 |
| 2 | `chore: remove TypeScript implementation and toolchain` | 另删 `.github/workflows/eval-optional.yml`（依赖 `pnpm eval:feature`）与 `.cursor/skills/moontide-feature-eval/`（TS eval skill）；`ci.yml` 去掉 `typescript` job，只留 `rust` |
| 3 | `chore: restructure to multi-language layout` | `.gitignore` 的 `ui/target/` 改为 `crates/moontide-ui/target/`，并删已失效的 `packages/evals/runs/`；`justfile` 额外提供 `fmt` / `run` / `ui` 目标 |
| 4 | `docs: rewrite README/TODO/AGENTS for Rust-first direction` | README 按代码实况写（Rust 无 `/debug`、无 `MOONTIDE_DEBUG`，Agent Event JSONL 与 `status.json` 尚未写入，已在文中标注）；TODO 其余小节指向归档文档的链接改为 `docs/archive/...`；`engineering-handbook.md` 顶部加「TS 时代版本」状态标注；`docs/README.md` §5 只列现存 README |

### 遗留项

- ~~`engineering-handbook.md` 需按 crate 边界重写或归档~~ → 已归档至 `docs/archive/guides/`；`docs/guides/` 当前无活跃 Guide，Rust 版工程手册待重建。
- **活跃 spec 仍引用已删除的 TS 路径**（`docs/spec/` 下 4 份文档共约 40 处 `packages/…` 链接与 `*.ts` 落点）。需按 crate 实现逐份校订或标注为「TS 时代落点」，这是 spec 层的独立工作，不在本迁移计划范围内。
- `crates/moontide-ui/target/` 是移动前的独立构建产物（约 2 GB），workspace 统一输出到根 `target/`，可安全删除。
- `just` 未在开发机安装，`just --list` 验收未执行（`cargo build --workspace` 与 `cargo test --workspace` 已通过）。
- `main` 分支的 TS 快照尚未 push 到 `origin`，回退仅依赖本地仓库。

---

## 迁移完成后的终态目录

```text
moontide/
├── crates/                  # Rust（Cargo workspace）—— 内核 + 推理 + CLI + UI
│   ├── agent-core/ # 未来：loop/context/prompt/session/permission/tools/scheduler/event/llm
│   ├── moontide-cli/
│   ├── moontide-ui/         # 原 ui/
│   └── ...
├── services/                # Go（后置）—— 后台监控/代理
├── node/                    # Node（后置）—— 扩展生态
├── schema/                  # 跨语言契约（JSON Schema）
├── docs/
│   ├── archive/             # TS 时代文档归档
│   └── ...
├── Cargo.toml               # 根 Cargo workspace
└── justfile                 # 统一编排入口
```
