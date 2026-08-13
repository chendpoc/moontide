# MoonTide UI

Read-only Slint sidecar for MoonTide. Reads `status.json.runId`, tails `workdir/.moontide/runs/<runId>.active.jsonl`, and renders **Trace**, **Context**, and **Chat** tabs.

The UI is live-only: it keeps already loaded rows across segment rotation, but does not read completed `.jsonl.gz` segments. After a UI restart, completed runs are not restored.

macOS-first (folder picker via `rfd`, file watching via `notify`).

**Requires Rust stable ≥ 1.89** (Slint 1.9 dependency tree). Project includes `rust-toolchain.toml`; first build may auto-install via rustup.

## 文档

| 文档 | 说明 |
|------|------|
| [`docs/README.md`](../docs/README.md) | Doc Map |
| [`docs/spec/agent-events.md`](../docs/spec/agent-events.md) | Agent Event Log schema（UI 消费的 JSONL 字段） |
| [`docs/product/plan.md`](../docs/product/plan.md) | 分段 JSONL 存储、retention 与非目标 |
| [`docs/notes/runtime/runtime-multilang.md`](../docs/notes/runtime/runtime-multilang.md) | 多语言 Desktop Runtime 架构讨论 |

## Prerequisites

- [rustup](https://rustup.rs) with **stable ≥ 1.89**
- MoonTide REPL writing `.moontide/` artifacts in the workdir

### Upgrade Rust (国内镜像)

```bash
export RUSTUP_DIST_SERVER="https://rsproxy.cn"
export RUSTUP_UPDATE_ROOT="https://rsproxy.cn/rustup"
rm -f ~/.rustup/downloads/*.partial
rustup update stable
rustc --version   # expect 1.89+
```

## Build & run

```bash
cd moontide/ui
cargo build
cargo run -- --workdir ..
```

Or from the repo root:

```bash
pnpm dev:ui
```

Use **Pick…** to switch workdir at runtime.

## 联调

Terminal 1 — MoonTide REPL:

```bash
cd moontide
pnpm dev
```

Terminal 2 — UI sidecar:

```bash
cd moontide
pnpm dev:ui
# or: cd ui && cargo run -- --workdir ..
```

Chat in terminal 1; Trace / Context / Chat tabs update as events append.

## Layout

| Path | Role |
|------|------|
| `ui/app-window.slint` | Main window, tabs, status bar |
| `src/store/event_store.rs` | Active JSONL cold read + tail, max 2000 in-memory events |
| `src/store/status_store.rs` | `status.json` reader |
| `src/watch/watcher.rs` | `notify` file watcher |

Event schema: [`docs/spec/agent-events.md`](../docs/spec/agent-events.md).
