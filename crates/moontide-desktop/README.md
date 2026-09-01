# MoonTide Desktop (Tauri)

Tauri 2 shell with integrated Desktop Host runtime (no separate `desktop` crate).

## Prerequisites

- Rust toolchain (same as workspace)
- macOS: Xcode CLT
- Node.js 22+ and pnpm 9 (`corepack enable` or `npm i -g pnpm`)
- `DEEPSEEK_API_KEY` in environment or `.env`

## Frontend

See [`frontend/README.md`](frontend/README.md). UI scope/interaction docs: [`docs/`](docs/).

```bash
cd crates/moontide-desktop/frontend
pnpm install
pnpm test
pnpm run check
pnpm run build
```

## Run (dev)

```bash
cd crates/moontide-desktop/src-tauri
cargo tauri dev
```

`cargo tauri dev` must run from the directory containing `tauri.conf.json`.

## Architecture

```text
WebView typed invoke → DesktopRuntimeCoordinator → DesktopRuntimeHandle → DesktopHost actor
Events: Host → desktop-envelope (connection_epoch + seq + snapshot/resync)
```

The coordinator keeps one in-process Session runtime per window. `new_chat`
closes the loaded runtime without deleting its Session Item Log, then prepares
a fresh ready runtime with a new `connection_epoch`.

Design contract: [`DESIGN.md`](DESIGN.md).

```bash
cargo test -p moontide-desktop
cargo clippy -p moontide-desktop --all-targets -- -D warnings
```

## Historical note

Independent `crates/desktop`, in-process protocol client/server transport, and D4 agent-host process split are **superseded**. See [`DESIGN.md`](DESIGN.md) and `docs/archive/`.
