# REPL Terminal：Rust parity 说明

> **范围：** `@moontide/agent-cli`（TypeScript）与 `moontide-cli`（Rust）interactive REPL 的终端 I/O 差异。TS 契约见 [`repl-terminal.md`](../../spec/repl-terminal.md)。

## 总览

| 方面 | TypeScript CLI | Rust CLI |
|------|----------------|----------|
| 对话输出 fd | **stderr**（Transcript + StatusStack + prompt） | **stdout**（reply 与 slash 响应） |
| stdout（interactive） | 空 | 承载 reply、`/help` 等 |
| StatusStack | 有（activity + statusline pin） | 无 |
| 流式 assistant | quiet 经 RunEvent → stderr Transcript | 无 streaming；run 完成后一次性 `println!` |
| readline 库 | Node `readline/promises` | `rustyline` |
| verbose / thinking | Observability 模式切换 trace 目标 | `ObservabilityState` 同类概念，输出仍走 stdout |

## stdout 差异（主要 parity gap）

Rust REPL（`crates/moontide-cli/src/repl.rs`）：

```rust
println!("\n{}\n", result.reply);  // assistant reply → stdout
println!("{}", help_text());       // slash 响应 → stdout
```

TypeScript REPL（Scheme B2）：

- `ReplTerminal` 与 Transcript 全部写 **stderr**
- interactive 模式下 **stdout 保持空**，便于 `2>/dev/null` 只保留错误、或 `> file` 不污染对话

这是有意的产品差异，不是遗漏。Rust CLI 尚未引入 StatusStack / Transcript 分层；未来若对齐，需单独 RFC（是否迁移 Rust 到 stderr-first 或 TS 增加 stdout 模式）。

## 共有行为

- Slash 命令别名（如 `/reset` → `/new` 在 Rust；TS 侧 `/reset` 走 command handler）
- Session id 出现在 prompt（Rust 显式 `[sessionId]`；TS `MoonTide >>`）
- Agent turn 失败：Rust `eprintln!` error line；TS `reportError` + stderr fallback

## 测试

TS 侧 PTY 测试（`tests/repl-terminal-pty.test.ts`）仅覆盖 TS 契约。Rust REPL 无等价 StatusStack 测试。
