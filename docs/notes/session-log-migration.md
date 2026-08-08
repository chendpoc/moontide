
> PR1b 定类型与路径；本文描述 loop 从 `MessageParam[]` 迁到 Session Log 的切换策略。

## 原则

- **Session Event Log** = 会话事实（append-only）
- **Agent Event Log** = 单次 run 观测（不变）
- **sessionId** = 一个 REPL 会话，跨多个 run；`/reset` 换新 id
- **runId** = 每次 user prompt 一次（已有）

## C1a — 双写（行为不变）

1. REPL 启动或 `/reset` 时 `newSessionId()`，内存持有当前 `sessionId`
2. loop 在现有 `messages.push` 时机 **并行 append** Session Log：
   - user prompt → `user_message`
   - LLM 返回 → `assistant_message`
   - tool 执行 → `tool_invocation` + `tool_outcome`
   - compact → `compaction`
3. **仍** `messages.splice` compact；`runLLM` 仍读 in-memory 数组
4. 可选：`messagesFromItems` 还原 `Message[]`，与 `messages[]` shadow diff（测试）

**验收：** `.moontide/sessions/<sessionId>.jsonl` 可 tail；REPL 续聊行为与 today 一致。

## C1b — compose 取代 splice

1. loop **停** `messages.splice`；compact 只写 `compaction` 事件 + 更新 compose / compaction 规则
2. `composeContext()` 读 `SessionLogReader`，经 `messages/project.ts` 产出 `LLMRequest.messages`
3. [`context/sessions.ts`](../src/context/sessions.ts) 只存 manifest / log 指针，不再持有 messages 引用
4. [`cli/repl/session.ts`](../src/cli/repl/session.ts) 改为 sessionId + reader，或委托 session 模块

**验收：** REPL 续聊、auto compact、`/compact` 命令不退化；loop 不 import SDK 消息类型（随 PR2/3）。

**执行细节（C1b 第 3 点）：** [`context-window-roadmap.md`](context-window-roadmap.md) #1 runtime-status — `runtime-status.ts` 替换 `sessions.ts`，只缓存 manifest/report。

## 不在 C1 范围

- Artifact Store（C2）
- Instruction State / AGENTS.md（C3）
- Compaction Record 持久化（C4）
- Checkpoint resume（C5）

## 相关 Spec

- [`context-window-roadmap.md`](context-window-roadmap.md) #1 — runtime-status 落地
- [`context-composer.md`](../spec/context-composer.md) §4–§5、§12 C1
- [`agent-events.md`](../spec/agent-events.md) — Agent vs Session 边界
- [`agent-run-hooks.md`](agent-run-hooks.md) — Agent 运行时 hook 设计（生命周期与注册实践）
