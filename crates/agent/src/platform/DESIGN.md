# agent::platform — 技术设计

## 1. Module seam

`platform` 是 `agent` 内受控公开的 module。它承载跨宿主复用且具有 OS 文件语义的行为；调用方不需要知道 Windows 替换文件与 Unix rename 的差异。

它不是 `std::fs` 的 facade。`PathBuf`、`Path::join`、`std::fs::read` 等没有跨平台策略变化的能力直接使用标准库。

## 2. `ProjectPaths::resolve`

输入是已经由宿主决定的 `cwd` 和可选目录覆盖值；module 不读取环境变量或 CLI 参数。若 `cwd` 为相对路径，module 使用进程当前目录将其绝对化。

处理顺序：

```text
cwd
  → 若为相对路径，以调用进程 cwd 转为绝对路径
  → 验证存在且为目录
  → sessions_dir / runs_dir
      → 绝对路径保持不变
      → 相对路径基于 resolved cwd join
      → 未提供时使用 cwd/.moontide/{sessions,runs}
  → settings_path = cwd/.moontide/settings.json
```

这里的绝对化不等于 `canonicalize`：不解析 symlink，不要求 sessions/runs 预先存在。目录创建与 bootstrap 失败仍由 Agent/宿主的现有路径校验负责。

## 3. Atomic settings replacement

实现必须满足：

1. 临时文件与目标文件位于同一父目录；
2. 临时文件使用不冲突的创建语义；
3. bytes 完整写入后才尝试替换目标；
4. 替换失败返回带路径上下文的 `anyhow::Result`；
5. 失败时不得删除或截断现有目标文件；
6. 不解析 bytes 内容，JSON 错误由 frontend 负责；
7. 第一版不提供并发 writer 保护。

Windows 与 Unix 的目标文件替换差异集中在本 module 内。测试不得依赖 `/tmp`、`HOME` 或固定分隔符，使用 `tempfile::TempDir` 与 `PathBuf` 构造路径。

## 4. Cross-platform conformance

所有平台共同运行：

- default project layout；
- relative/absolute override；
- cwd validation；
- settings path derivation；
- atomic write output is complete JSON bytes；
- invalid target/replace error retains the original target when the platform permits verification。

真实 OS 差异单独测试，不把 shell/PTY/file lock 伪装成本 module 的当前能力。

## 5. Future extraction

当 Desktop 成为第二个独立消费者，或 platform 出现第二个真实 OS Adapter，再评估提取为 `agent-platform` workspace crate。当前保留在 `agent` 以维持组合根的 Locality。
