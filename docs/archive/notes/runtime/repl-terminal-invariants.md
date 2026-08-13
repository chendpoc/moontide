# REPL 终端不变量

> **文档性质：** notes（B2 实现参考；正式契约见 [`repl-terminal.md`](../../spec/repl-terminal.md)）
> **范围：** `@moontide/agent-cli` interactive REPL

## 分层

| 层 | 职责 | 模块 |
|----|------|------|
| **Transcript** | 对话正文 append-only | `cli/repl/transcript.ts` |
| **StatusStack** | prompt 上方 pin 栈（activity + statusline） | `cli/statusline/render-stack.ts` |
| **ReplTerminal** | 唯一 cursor owner | `cli/repl/terminal.ts` |
| **Input** | readline；仅经 `ReplTerminal.question()` | — |

## 不变量

1. **同一时刻只有一个 cursor owner**（Input | Transcript 写入 | StatusStack repaint | trace/error block）。
2. **readline 等待输入时**：StatusStack 不得 `stackPinned`；activity tick 不得触发 `renderStatusStack`（`setActivityRepaintEnabled(false)`）。
3. **assistant 文本每段恰好显示一次**：quiet → Transcript（stderr append）；verbose → Agent Event trace，Transcript 仅 user。
4. **成功 run 的最终 reply 不可消失**（含 `message_start` → 无 `message_update` → `message_end` 全文路径）。
5. **已 commit 的 transcript 行永不擦除**（B2 不做 multiline 原地 `\r\x1b[2K` repaint）。

## ReplTerminal 序列

### 主 prompt

```text
beforePrompt()  →  question(prompt)  →  afterPrompt()
```

- `beforePrompt`：`suspendStatusStack()` + `setActivityRepaintEnabled(false)`
- `afterPrompt`：`setActivityRepaintEnabled(true)` + `await resumeStatusStack()`

tool approval / `askQuestion` 内每个 `question()` 同样走完整序列。

### Agent turn（quiet）

```text
appendTurnSeparator?()
appendUser(originalPrompt)
beginAgentActivity()
RunEvent → projection → onAssistantDelta / onAssistantEnd
await flush()
endAgentActivity()
fallback if !hadOutput && reply
```

- 首 `text_delta`：`suspendStatusStack()`，随后 delta **直接** `writeStderr(text)`（无换行）。
- `message_end`：对账 suffix → 一个 `\n` → `resumeStatusStack()`（turn 未结束，activity 继续）。

### message_end 对账

| 条件 | 行为 |
|------|------|
| `streamedText` 为空 | `onAssistantEnd(finalText)` 输出全文 |
| `finalText.startsWith(streamedText)` | 仅输出 `finalText.slice(streamedText.length)` |
| 否则（mismatch） | 输出 `\n` + `finalText`（罕见；Provider 重发完整 message） |

## 例外

- Slash 命令 `reply()`：idle、无 pin 时可直接 `writeStderrLine`（不经 ReplTerminal）。
- `StderrRenderer` / `reportError`：经 `notifyExternalStderrWrite` unpin 状态；下次 `renderStatusStack` 重绘。

## Rust parity

见 [`repl-terminal-rust-parity.md`](repl-terminal-rust-parity.md)。
