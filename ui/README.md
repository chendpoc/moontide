# Oculeau UI

Read-only Slint sidecar for Oculeau. Watches `workdir/.oculeau/events.jsonl` and `status.json`, renders **Trace**, **Context**, and **Chat** tabs.

macOS-first (folder picker via `rfd`, file watching via `notify`).

**Requires Rust stable ≥ 1.89** (Slint 1.9 dependency tree). Project includes `rust-toolchain.toml`; first build may auto-install via rustup.

## Prerequisites

- [rustup](https://rustup.rs) with **stable ≥ 1.89**
- Oculeau REPL writing `.oculeau/` artifacts in the workdir

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
cd oculeau/ui
cargo build
cargo run -- --workdir ..
```

Or from the repo root:

```bash
pnpm dev:ui
```

Use **Pick…** to switch workdir at runtime.

## 联调

Terminal 1 — Oculeau REPL:

```bash
cd oculeau
pnpm dev
```

Terminal 2 — UI sidecar:

```bash
cd oculeau
pnpm dev:ui
# or: cd ui && cargo run -- --workdir ..
```

Chat in terminal 1; Trace / Context / Chat tabs update as events append.

## Layout

| Path | Role |
|------|------|
| `ui/app-window.slint` | Main window, tabs, status bar |
| `src/store/event_store.rs` | JSONL cold read + tail, max 2000 events, latest `runId` |
| `src/store/status_store.rs` | `status.json` reader |
| `src/watch/watcher.rs` | `notify` file watcher |

Event schema: [../docs/EVENTS.md](../docs/EVENTS.md).
