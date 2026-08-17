本文件是 MoonTide 运行时指令来源之一：由 `agent` 在每个 user turn 解析为 `SystemPrompt`，再由 `model_input::compile` 写入 `ModelRequest.system`。

**完整工程手册**（Rust 分层、Conformance 范围、术语全集、示例）位于 [`crates/docs/engineering-handbook.md`](crates/docs/engineering-handbook.md)。TypeScript 时代版本已归档至 [`docs/archive/guides/engineering-handbook.md`](docs/archive/guides/engineering-handbook.md)，仅供追溯；冲突时以本文件为准。维护规则：**runtime 必需、可执行的约束写本文件**；详述、表格与链接写 Rust handbook。

代码库是 Rust（Cargo workspace，`crates/`）。TypeScript 初版已删除，快照在 `main` 分支，文档在 [`docs/archive/`](docs/archive/)。

---

## 对话风格

- 回答简短精炼；只写技术性文字
- 提交、issue、PR、代码中不用 emoji；不要客套填充语
- 用户提问时先回答，再改代码或跑命令
- 回应反馈时先明确同意或不同意，再说明改动

---

## 代码质量

- 大范围改动或审计前先完整读文件，不靠搜索片段
- 错误用 `anyhow::Result` 传播；库代码不 `unwrap()` / `expect()`，不 panic
- 查 crate 源码或 docs.rs，不猜 API
- 模块内部项不加 `pub`；跨 crate 才 `pub`，crate 内共享用 `pub(crate)`
- 编译产物只在 `target/`，不提交
- 删有意功能前先问用户；除非用户要求，不做向后兼容
- 每个 `#[test]` / `#[tokio::test]` 前必须写注释说明测试场景、预期结果和不变量/副作用约束；测试行为变化时同步更新注释

---

## 命令

- 代码变更后（文档除外）：`just check`（= `cargo fmt --all --check` + `cargo clippy --workspace --all-targets` + `cargo test --workspace`），修完所有 fmt/clippy/test 再提交
- **Git hooks（可选）：** `pre-commit install` + `pre-commit install --hook-type pre-push`（见根目录 `.pre-commit-config.yaml`）— commit 跑 `just pre-commit`（fmt + clippy），push 跑 `just pre-push`（workspace test）；需 `rustup component add rustfmt clippy`
- 未经用户要求：不跑 release build（`cargo build --release`）
- 只改单个 crate 时：`cargo test -p <crate>` 直到通过，再跑 workspace
- CI 与未装 hook 时：检查靠手动 `just check`
- 临时脚本写 `/tmp` 等临时文件，不嵌多行 bash
- 未经用户要求不提交

---

## Git

cwd 可能有多 agent 并行；勿碰其他会话未暂存文件。

**提交：** 只提交本会话改动的文件；`git add <path>` 显式路径，禁止 `git add -A` / `.`；提交前 `git status`；信息格式 `{feat,fix,docs}[(scope)]: …`

**禁止：** `git reset --hard`、`checkout .`、`clean -fd`、`stash`、`git add -A`、`commit --no-verify`、force push

**rebase 冲突：** 只改本会话动过的文件；未改文件冲突则中止并问用户

---

## Issue 与 PR

- 审查 PR 不 `gh pr checkout` / 不切分支；用 `gh pr view/diff`、`git show <ref>:<path>`
- 评论用 `gh … comment --body-file`，不用 `--body` 传多行
- 关闭 issue：提交信息含 `fixes #n` 或 `closes #n`（多 issue 各写关键字）

---

## 工程原则（摘要）

1. **分层** — MVP 四 crate：`agent-core`（引擎）、`agent-tools`（第一方 catalog/builtins）、`agent`（组合根）、`cli`（纯壳）。`agent-tools → agent-core`，`agent` 依赖二者，`agent-core` 不反向依赖任何上层 crate。内核 8 个内部 mod（`llm` / `session` / `tools` / `event` / `model_input` / `context` / `loop` / `scheduler`），不拆 crate。Session Log 为事实源，Agent Event 仅 derive。架构见 [`crates/docs/agent-core.md`](crates/docs/agent-core.md)。
2. **高内聚低耦合** — `session` 不依赖 `loop` / `agent`；permission 是组合根随 tool 注册声明的 `tool_name → Allow | Ask` map，由 `loop` 查表，缺失项安全拒绝；当前不设独立 permission mod。
3. **Spec / Impl 分离** — tool schema 与 handler 分开；handler 不定义 schema，schema 无 IO 副作用。
4. **声明式注册表** — tool 注册用表驱动；新增 tool 改表不改长 match。
5. **Conformance 守门** — 注册表与边界变更须有结构测试守门（Rust 侧待重建，TS 版见 archive）；不变量写测试，热路径不加 runtime assert。
6. **简单冗余** — 不为省行数抽泛型；相似 store 可各写一份。

详表与示例：Rust handbook §1–§7（分层部分以上表为准）。

---

## 术语（摘要）

**过程：**

| 过程 | 用词 |
|------|------|
| Session Item Log → messages | **materialize**（不用 derive_messages / 投影 / 还原） |
| SystemPrompt + messages + tools → ModelRequest | **compile**（不用 compose） |
| RunEvent → Agent Event | **derive**（`event::derive` 已落地；完整 bus/sidecar 仍后置） |

**实体：**

| 实体 | 用词 |
|------|------|
| 整场 session 的 append-only 事实源 | **Session Item Log**（不用 Session Event Log / SessionLog / Item Log） |
| log 中的一条记录 | **SessionItem**（不用 SessionEvent / SessionLogEntry） |
| 单次 run 的观测日志 | **Agent Event Log**（不用 RunEvent log / 观测流） |

内核：**RunEvent bus**（不用 sink）、**resolveRunConfig** / **resolveTurnContext**（不用 fold 指 config）。sidecar 只经文件消费，不走 IPC。

完整术语表（canonical + 别名禁用 + 关系 + 冲突裁决）：[`UBIQUITOUS_LANGUAGE.md`](UBIQUITOUS_LANGUAGE.md)。

---

## 错误边界

- Tool 预期失败：把错误文本作为 tool result 返回给模型，不 panic
- tool / LLM 调用：错误经 `Result` 传到 run 边界统一处理，不在中途吞掉
- executor 基础设施错误：`loop` 先 emit `OutcomeUnknown` 的 `ToolResultRecorded`，再把原始 `Result::Err` 传到 run 边界，禁止留下已记录但无 `ToolResult` 的 `ToolCall`
- REPL turn 失败：打印 ERROR 后 REPL 继续（配置类致命错误除外）
- 排查：stderr ERROR → `/thinking on` → `.moontide/sessions/*.jsonl`

详表：Rust handbook §6–§7。

---

## 用户覆盖

用户指令与本文件冲突时，先请求显式确认再覆盖。
