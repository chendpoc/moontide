# REPL Terminal（TypeScript CLI）

> **范围：** `@moontide/agent-cli` interactive REPL 的终端 I/O 契约。Rust CLI 差异见 [`repl-terminal-rust-parity.md`](../notes/runtime/repl-terminal-rust-parity.md)。

## 分层

| 层 | 职责 | 模块 |
|----|------|------|
| **Transcript** | 对话正文 append-only 格式化 | `cli/repl/transcript.ts` |
| **StatusStack** | prompt 上方 pin 栈（activity + statusline） | `cli/statusline/render-stack.ts` |
| **ReplTerminal** | 唯一 cursor owner | `cli/repl/terminal.ts` |
| **Input** | readline；仅经 `ReplTerminal.question()` | `cli/repl/interaction.ts` · `cli/repl/run.ts` |
| **RunEvent projection** | RunEvent → Transcript（assistant 流式/全文） | `cli/repl/run-event-projection.ts` |

## 不变量

1. **同一时刻只有一个 cursor owner**（Input | Transcript 写入 | StatusStack repaint | error block）。
2. **readline 等待输入时**：StatusStack 不得 `stackPinned`；activity tick 不得触发 `renderStatusStack`（`setActivityRepaintEnabled(false)`）。
3. **assistant 文本每段恰好显示一次**：quiet Transcript（stderr append）；观测 trace **不**打终端，见 `.moontide/runs/*.jsonl`。
4. **成功 run 的最终 reply 不可消失**（含 final-only 路径）。
5. **已 commit 的 transcript 行永不擦除**（B2 不做 multiline 原地 `\r\x1b[2K` repaint）。

实现细节与序列图见 [`repl-terminal-invariants.md`](../notes/runtime/repl-terminal-invariants.md)。

## fd 矩阵（interactive REPL）

| 模式 | stdout | stderr |
|------|--------|--------|
| **默认** | 空 | Transcript（user + assistant）+ StatusStack + prompt + ERROR 块 |

**硬约束：** interactive REPL 不向 stdout 写对话正文。

## 观测与 debug

| 能力 | 终端 | 落盘 |
|------|------|------|
| Agent Event trace | **无** | 始终 `.moontide/runs/<runId>.active.jsonl` |
| Debug compose/llm/tool 全量 | **无** | `MOONTIDE_ENV=dev` 默认开；`/debug on` 或 `MOONTIDE_DEBUG=file` |

已移除 `/verbose`、`/thinking` 与终端 trace 渲染；debug 仅 file tier。

## 验收

- 单元：`tests/repl-transcript.test.ts` · `tests/repl-stream-integration.test.ts`
- PTY 集成：`tests/repl-terminal-pty.test.ts`
- StatusStack：`tests/statusline.test.ts`
