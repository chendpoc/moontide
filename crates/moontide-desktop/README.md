# MoonTide Desktop (Tauri)

Tauri 2 shell for the MoonTide protocol-first Desktop vertical slice.

## Prerequisites

- Rust toolchain (same as workspace)
- macOS: Xcode CLT
- `DEEPSEEK_API_KEY` in environment or `.env`

## Run (dev)

From repository root:

```bash
cargo tauri dev --manifest-path crates/moontide-desktop/src-tauri/Cargo.toml
```

If `cargo tauri` is unavailable, install the CLI once:

```bash
cargo install tauri-cli --version "^2"
```

## Architecture

```text
frontend typed DesktopCommand intent
  → one Tauri desktop_request bridge
    → Rust DesktopProtocolClient (request ID + epoch owner)
      → bounded in-process envelope transport
        → DesktopProtocolServer → DesktopHost → Agent
```

The frontend subscribes to `desktop-envelope` before Handshake and StartSession. Responses and
events use the frozen `desktop-protocol` v1 JSON shape; transport failures use the separate
`desktop-connection` lifecycle notification. The Tauri shell owns only window lifecycle, the
allowlisted bridge and the injected protocol client. `bootstrap.rs` is the D3 composition root and
is the only Tauri-crate module that builds the current `AgentConfig`.

Focused verification:

```bash
cargo test -p moontide-desktop
cargo clippy -p moontide-desktop --all-targets -- -D warnings
```

## Next steps

- Replace plain JS with Svelte + TypeScript `RenderState`
- Add TypeScript conformance for all `desktop-protocol` fixtures
- Split `agent-host` process (D4)
