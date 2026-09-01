# Desktop Backend Communication Conventions

Document status: **已 superseded（2026-09-01）**

Decision status: **已 superseded；目标仍尚未实现**

Canonical contract:
[`crates/moontide-desktop/DESIGN.md`](../moontide-desktop/DESIGN.md)

Scope: historical design input for the same-process Tauri backend.

本文不再是 canonical contract。`DesktopRuntimeHandle`、typed invoke、单 Host mailbox、
错误接受语义与稳定事件 seam 以替代 DESIGN 为准；本文保留用于追溯决策来源。

## Goal

Simplify the Desktop backend request path and make its naming consistent. This
is an engineering cleanup, not a new product architecture.

Current active path:

```text
Tauri command
  -> DesktopProtocolClient
  -> ClientTransport
  -> DesktopProtocolServerHandle
  -> DesktopHostHandle
  -> DesktopHost actor
```

Target active path:

```text
typed Tauri command
  -> DesktopRuntimeHandle
  -> DesktopHostHandle
  -> DesktopHost actor
```

`DesktopRuntimeHandle` is a plain lifecycle facade, not another actor. Only
`DesktopHostHandle` sends to the single Host mailbox.

The event path is unchanged:

```text
DesktopHost actor
  -> DesktopEventStream
  -> Tauri event pump
  -> Svelte RenderState
```

## Naming

| Name | Meaning |
|---|---|
| `Handle` | Same-process capability for a runtime or actor |
| `Command` | Typed intent sent to an actor |
| `Reply<T>` | Private oneshot response carried by a command |
| `Client` | Caller across a real process, network, or external-service boundary |
| `Broker` | Owner of a delayed correlated domain decision, such as approval |
| `EventStream` | Ordered one-way observation of Host facts |
| `Sender` | Private implementation field, not a public application API |

Do not call a local actor handle a `Client`. Do not expose raw Tokio senders
outside the owning module.

## Ownership

- Tauri commands deserialize input, call `DesktopRuntimeHandle`, and serialize
  the result. They contain no Agent or Session logic.
- `DesktopRuntime` owns bootstrap, the active Host handle, replacement, and
  shutdown coordination.
- `DesktopHost` remains the only owner of Agent, Session, Turn, tool, approval,
  and runtime lifecycle facts.
- Svelte continues to own only `RenderState`, drafts, and local UI state.

This cleanup does not change Session Item Log authority, approval ownership,
credential handling, or Tauri security capabilities.

## Local Request/Reply

Keep Tokio bounded `mpsc` plus `oneshot`. Repeated mailbox plumbing belongs in
one private `DesktopHostHandle::call` helper:

```rust
type Reply<T> = oneshot::Sender<Result<T, DesktopCommandError>>;

async fn call<T>(
    &self,
    make_command: impl FnOnce(Reply<T>) -> HostCommand,
) -> Result<T, DesktopCommandError>;
```

Public methods remain domain-specific. The raw sender and `call` helper remain
private.

Required semantics:

- successful enqueue means the Host accepted responsibility for the command;
- a reply reports that command's result, not event delivery;
- `submit_turn` replies after acceptance; terminal Turn outcome arrives through
  events;
- dropping or timing out the caller does not implicitly cancel accepted work;
- Turn cancellation remains an explicit Host command;
- the Host receive loop must remain responsive while a Turn executes;
- the single Host mailbox is bounded and never silently drops lifecycle, Turn,
  Stop, or approval commands.

Use separate errors for “not enqueued” and “enqueued but no reply” so the caller
does not guess whether the Host accepted responsibility. Exact names and queue
capacity are implementation details fixed in the implementation batch and
covered by focused tests.

Tauri invoke already correlates a WebView call with its result. Do not add a
custom local `request_id` or general protocol envelope. The private oneshot is
only the internal Host command reply port.

## Events Remain Stable

Removing the fake local request transport must not change event behavior.

- keep `connection_epoch` and monotonic `seq`;
- keep listener-first startup, snapshot baseline, gap detection, and resync;
- keep Rust/TypeScript conformance for values that actually cross the WebView
  boundary;
- keep live-only side effects suppressed during snapshot and replay.

## Dependency Decision

Use the existing Tauri, Tokio, and Serde stack. Do not add `tarpc`, `tonic`, an
actor framework, Tower, or a new generic RPC abstraction for this cleanup.

## Implementation Boundary

Implement in three reviewable steps:

1. Add or normalize the typed runtime/Host handles and focused mailbox tests.
2. Rewire Tauri commands to the local handles while preserving the event path.
3. Remove the unused local protocol client, transport, server, custom request
   correlation, and their dead tests.

Do not keep a compatibility path without a current consumer. If a real current
process or network consumer is found, stop and revise this decision before
removing its boundary.

## Acceptance

- the same-process request path has no fake client, transport, or server;
- one Host mailbox serializes Host commands;
- public APIs expose typed methods rather than senders;
- Tauri invoke uses typed values without custom request correlation;
- event ordering, snapshot, and resync tests continue to pass;
- focused error, timeout, cancellation, and saturation tests pass;
- no new communication or actor framework dependency is added;
- repository checks required by the engineering handbook pass.

## Non-goals

Remote/cloud agents, a daemon process, protocol versioning, multi-agent work,
Session persistence, and UI design are outside this cleanup.

This document supersedes only the older requirement that same-process requests
must traverse `DesktopProtocolClient`, `ClientTransport`, and
`DesktopProtocolServer`. Existing Host ownership, event, conformance, and
security contracts remain current.
