# agent::platform

> **性质：** `agent` 组合根的跨平台宿主路径 seam。
> **状态：** 当前实现契约，R1 已实现，待 Review。

## 目的

集中项目级路径策略和设置文件原子替换，让 CLI、Desktop 等宿主共享相同的 workspace 语义，同时不把所有 `std::fs` / `std::path` 包装成浅层 common module。

## 对外契约

```rust
pub struct ProjectPaths {
    pub cwd: PathBuf,
    pub sessions_dir: PathBuf,
    pub runs_dir: PathBuf,
    pub settings_path: PathBuf,
}

impl ProjectPaths {
    pub fn resolve(
        cwd: PathBuf,
        sessions_dir: Option<PathBuf>,
        runs_dir: Option<PathBuf>,
    ) -> anyhow::Result<Self>;
}

pub fn write_settings_atomically(path: &Path, bytes: &[u8]) -> anyhow::Result<()>;
```

## 路径契约

- `cwd` 解析为绝对路径，并且必须是现有目录；
- 相对 `sessions_dir` / `runs_dir` 以 resolved `cwd` 为基准；
- 默认布局为 `<cwd>/.moontide/{sessions,runs}`；
- `settings_path` 固定为 `<cwd>/.moontide/settings.json`；
- 不手写平台分隔符；
- 使用 `Path` / `PathBuf` / `OsStr`；
- 普通解析不调用 `canonicalize`；
- 不读取环境变量、不解析 JSON、不创建 Session Store。

## 设置文件契约

设置 schema 和 JSON 解析由 frontend 拥有。文件从第一版带 `version: 1`。`api_key` 允许持久化；它不进入 Session Item Log 或 Agent Event Log。

项目设置中的 `persistence.session` 与 `persistence.diagnostic` 解析为
`PersistenceConfig` 后注入 `AgentConfig`；默认值是
`SessionPersistence::Items + DiagnosticPersistence::Off`。该 policy 的完整契约见
[`crates/docs/logging-and-session-design.md`](../../../docs/logging-and-session-design.md)。

`write_settings_atomically` 只负责完整 bytes 的跨平台原子替换，第一版假设一个 workspace 只有一个 settings writer。读取失败、JSON 损坏或未知版本由 frontend 显式报告并保留原文件。

## 非目标

- 通用文件读取/写入 wrapper；
- 用户级 config/data/cache 目录；
- shell、PTY、进程组、sandbox；
- 文件锁、revision 或 concurrent writer；
- Session Item Log 和 Agent Event Log 的读写。
