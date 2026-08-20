# agent::platform TASKS

## Review 批总览

| 批 | TASK | 主题 | 预估 |
|---|---|---|---:|
| R1 | platform-01–04 | 路径策略、设置持久化与三平台门禁 | ~900 行 |

## TASK 明细

### TASK-platform-01: ProjectPaths 路径策略

- **做什么：** 实现项目级 `cwd/sessions/runs/settings` 路径解析，保留相对路径基准和不 canonicalize 契约。
- **依赖：** 无
- **范围：** `crates/agent/src/platform/`、`crates/agent/src/lib.rs`、agent 文档
- **预估 diff：** ~250 行
- **完成标准：** `cargo test -p agent`
- **状态：** ☑

### TASK-platform-02: settings 原子写入

- **做什么：** 实现同目录临时文件写入和跨平台目标替换；frontend 继续拥有 JSON schema。
- **依赖：** TASK-platform-01
- **范围：** `crates/agent/src/platform/`、agent 测试
- **预估 diff：** ~250 行
- **完成标准：** `cargo test -p agent`
- **状态：** ☑

### TASK-platform-03: CLI settings persistence 与优先级

- **做什么：** 加入 `settings.json` version 1、读取/写入、CLI/env/file/default 优先级和 `--api-key`；损坏配置显式失败。
- **依赖：** TASK-platform-01–02
- **范围：** `crates/cli/src/args.rs`、`settings.rs`、`config.rs`、相关测试
- **预估 diff：** ~300 行
- **完成标准：** `cargo test -p cli`
- **状态：** ☑

### TASK-platform-04: 三平台 CI conformance 门禁

- **做什么：** 增加 macOS、Windows、Linux 的 workspace fmt/clippy/test workflow，并为 CLI smoke test 留出平台分层入口。
- **依赖：** TASK-platform-01–03
- **范围：** `.github/workflows/`、CI 文档
- **预估 diff：** ~100 行
- **完成标准：** workflow YAML 可解析，平台命令与 `just check` 一致
- **状态：** ☑
