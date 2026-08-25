# agent-tools 实现任务

> 依据 [`README.md`](README.md) 对外契约与 [`DESIGN.md`](DESIGN.md) 技术方案拆分。
> 当前 R1 与 `web_search` R1.2 已完成；`find` 与 `web_search` 均在同一 catalog 边界内。
> `web_fetch`、permission、runtime registry 与 scheduler 仍不属于本 crate。

## R1 范围

- **允许修改：** `crates/agent-tools/**`、根 `Cargo.toml`、`Cargo.lock`，以及直接记录进度的 README / handbook / `PROGRESS.md`。
- **禁止修改：** `agent-core` 的公开 tools API 与 loop/session/event/llm 实现；如果 `agent-tools` 无法使用当前公开 API，停止实现并回架构确认。
- **依赖：** `agent-core`、`anyhow`、`globset`、`ignore` 0.4、`regex`、`serde`、`serde_json`、`tokio`；测试使用 `tempfile`。
- **验证：** 先 `cargo test -p agent-tools`，再执行 `just check`；`just` 不可用时执行等价的 fmt + clippy + workspace test。

## Work Packet: web_search R1.2

- **Base:** 当前 checkout；工作树已有其他 agent 的 Desktop、文档和历史 Tavily-only 改动，不能重置、清理或广泛 stage。
- **Mode:** Implementation。
- **Goal:** 在 `agent-tools` 内交付无 API key 的 DuckDuckGo HTML + 可选 SearXNG JSON best-effort aggregate。
- **Source of truth:** 根 `AGENTS.md`、本文件、`README.md`、`DESIGN.md`、`agent-core::tools` 当前 API、现有 `web_search` 测试。
- **Confirmed decisions:** `web_search` 保持 query/max_results schema；provider 不进入 `agent-core`；endpoint 不由模型控制；SearXNG 由 `MOONTIDE_SEARXNG_BASE_URL` 配置；顺序聚合、稳定去重、保留来源；Tavily/Brave/Gemini Web/web_fetch 后置。
- **Scope:** `crates/agent-tools/Cargo.toml`、`Cargo.lock`、`README.md`、`DESIGN.md`、`TASKS.md`、`src/web_search/**`、必要的 catalog/schema 测试。
- **Non-goals:** API-key provider、浏览器 cookies、任意 URL fetch、cache、retry、health probe、scheduler 并发、agent-core API 变化。
- **Agent Task:** 实现统一结果模型、两个 provider、aggregator、错误聚合、输出格式和 wiremock 测试。
- **Reviewer:** Tidewatch；独立检查 live source、当前 diff、测试证据、Standards / Spec。
- **User Parallel Task:** Review 本批的 provider owner、配置边界、部分失败语义和验收路径，不修改 `src/web_search/**`。
- **Shared Acceptance:** `cargo test -p agent-tools` 与 `just check`；无真实网络；单 provider 失败不阻断另一个 provider；全失败 retryable 规则、URL 去重和 provider attribution 可复现。
- **Stop conditions:** 必须改变 `agent-core` API、Tool schema、endpoint 由模型控制、加入 API key/browser credential、或需要并发 scheduler 语义时暂停并重新架构对齐。

## R1.2 Review 批

| 批 | TASK | 主题 | 预估 diff | 状态 |
|---|---|---|---:|---|
| R1.2 | agent-tools-06–08 | 无 key provider、aggregator 与行为测试 | ~700–1000 行 | ☑ |

## Review 批总览

| 批 | TASK | 主题 | 预估 diff | 状态 |
|---|---|---|---:|---|
| R1 | agent-tools-01–03 | 独立 crate、声明式 catalog、内建 read/write/edit/find/grep/bash 与结构测试 | ~1800–2200 行 | ☑ |
| R1.1 | agent-tools-05 | 历史 Tavily-only `web_search` scaffold | ~350 行 | ☑ |
| R1.2 | agent-tools-06–08 | 无 API key provider、aggregator 与行为测试 | ~700–1000 行 | ☑ |

约 2000 行是软预算；本批优先保持一个可独立理解的 tracer-bullet 边界，实际超出时说明原因，不按数字机械拆散 spec/executor/测试。

## TASK 明细

### TASK-agent-tools-01: 建立 crate 与静态 catalog

- **做什么：** 将 `agent-tools` 加入 workspace，实现私有字段的 `ToolDefinition`、零参数 builder 和稳定的 `builtin_tool_definitions()` 静态 slice。build 时校验 definition name 与产出的 `ToolSpec.name` 一致；不创建 `ToolLibrary`、manifest、build context 或第二套 registry。
- **依赖：** `agent-core::tools` RB1
- **范围：** 根 `Cargo.toml`、`Cargo.lock`、`crates/agent-tools/Cargo.toml`、`src/lib.rs`、`src/catalog.rs`
- **预估 diff：** ~180 行
- **完成标准：** `cargo check -p agent-tools` 通过；catalog API 与 README 完全一致
- **状态：** ☑

### TASK-agent-tools-02: 实现内建 `grep`

- **做什么：** 物理分离 `grep` 的 Draft 2020-12 spec 与文件 executor；支持 pattern、相对 target 和 max_results，在 canonical working directory 内用 `ignore` + `regex` 完成稳定、有界、只读搜索。blocking IO 经 `spawn_blocking`，executor 直接返回受控构造的 `ToolResult`，不实现 permission 或 TurnEvent。
- **依赖：** TASK-agent-tools-01
- **范围：** `src/grep/mod.rs`、`src/grep/spec.rs`、`src/grep/executor.rs`
- **预估 diff：** ~420 行
- **完成标准：** 单文件/目录搜索、ignore、containment、binary/UTF-8 与输出截断语义均可由临时目录测试
- **状态：** ☑

### TASK-agent-tools-04: 补充 `find` 文件发现工具

- **做什么：** 在现有静态 catalog 中增加 Pi 风格的 `find` builtin。按 glob 发现工作目录内的 regular file，不读取内容，遵守 ignore 规则并限制结果数量。
- **依赖：** TASK-agent-tools-01
- **范围：** `src/find/**`、`src/catalog.rs`、`src/lib.rs`、`src/tests.rs`、相关 README / DESIGN
- **预估 diff：** ~300 行
- **完成标准：** `cargo test -p agent-tools` 与 `cargo clippy -p agent-tools --all-targets -- -D warnings` 通过
- **状态：** ☑

### TASK-agent-tools-03: 补 catalog 与 grep 契约测试

- **做什么：** 为 catalog 排序/唯一/name 配对和 grep 的 schema、搜索、失败、边界、输出预算建立测试；每个测试前写清场景、预期和不变量/副作用。测试不读取真实仓库、不访问网络、不依赖外部 `rg`。
- **依赖：** TASK-agent-tools-01、TASK-agent-tools-02
- **范围：** `src/tests.rs`、`src/grep/executor.rs` 测试模块、必要的测试辅助函数
- **预估 diff：** ~350 行
- **完成标准：** `cargo test -p agent-tools` 与 workspace `just check` 通过
- **状态：** ☑

### TASK-agent-tools-05: 实现内建 `web_search`

- **做什么：** 历史 Tavily-only scaffold；不作为当前无 API key provider 契约。
- **依赖：** TASK-agent-tools-01
- **范围：** `src/web_search/**`、`src/catalog.rs`、`src/lib.rs`、`src/tests.rs`、相关 README / DESIGN
- **预估 diff：** ~350 行
- **完成标准：** `cargo test -p agent-tools` 与 `cargo clippy -p agent-tools --all-targets -- -D warnings` 通过
- **状态：** ☑（历史 scaffold）

### TASK-agent-tools-06: 统一 web search 模型与 provider 边界

- **做什么：** 将当前 Tavily-only executor 收敛为 `SearchRequest`、`SearchResult`、provider identity 和 provider error 的 crate-private 统一边界；保留现有 `web_search` ToolSpec 与 catalog contract。
- **依赖：** TASK-agent-tools-01、R1.2 架构对齐
- **范围：** `src/web_search/{mod.rs,model.rs,aggregator.rs}`、相关 README / DESIGN、必要的 Cargo 依赖
- **预估 diff：** ~250 行
- **完成标准：** 两个 provider 可以通过统一边界装配，错误与结果类型不进入 `agent-core`
- **状态：** ☑

### TASK-agent-tools-07: 实现 DuckDuckGo 与 SearXNG provider

- **做什么：** 增加固定 DuckDuckGo HTML provider 与 `MOONTIDE_SEARXNG_BASE_URL` 可选 SearXNG JSON provider；实现 endpoint 校验、响应解析和单 provider retryable 分类。
- **依赖：** TASK-agent-tools-06
- **范围：** `src/web_search/providers/**`、`src/web_search/aggregator.rs`、`Cargo.toml` / `Cargo.lock`
- **预估 diff：** ~350 行
- **完成标准：** 每个 provider 都有 wiremock 成功、空结果、malformed response 和 HTTP failure 测试；不访问真实网络
- **状态：** ☑

### TASK-agent-tools-08: 聚合、去重、格式化与 conformance 测试

- **做什么：** 实现顺序 best-effort aggregate、canonical URL 去重、provider attribution、部分成功 warning、全失败 retryable 聚合和 32 KiB 输出限制。
- **依赖：** TASK-agent-tools-06、TASK-agent-tools-07
- **范围：** `src/web_search/{aggregator.rs,executor.rs}`、`src/tests.rs`、web_search 测试模块、README / DESIGN 同步
- **预估 diff：** ~350 行
- **完成标准：** focused tests 覆盖 provider failure isolation、dedupe、partial success、all failure 和 output bound；`cargo test -p agent-tools` 通过
- **状态：** ☑

## 验收映射

| 契约 | R1 验证 |
|------|---------|
| `ToolDefinition` 最小公开 API | 跨模块编译使用测试 |
| catalog 稳定、唯一、build name 配对 | catalog 结构测试 |
| 无第二套 registry / permission | 模块可见性与依赖审查 |
| grep spec / executor 分离 | 文件结构与 import 审查 |
| working_dir containment / symlink 不越界 | 临时目录行为测试 |
| `.gitignore`、稳定遍历、单文件搜索 | grep 行为测试 |
| invalid regex / path / IO 错误映射 | executor 失败测试 |
| binary、非 UTF-8、max_results、32 KiB | 有界输出测试 |
| workspace 质量门禁 | `just check` |
