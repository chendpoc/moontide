# event — 技术设计

> **读者：** 实现者、代码审查。对外契约见 [`README.md`](README.md)。
> **状态：** commit-only R1 已实现。

---

## 1. 职责与边界

| 做 | 不做 |
|---|---|
| 定义写入 Session Item Log 的 `TurnEvent` | 定义 Session 存储格式 |
| 通过 `CommitHandler` 隔离 event 与 session 实现 | 观测、hook、permission、UI 协议 |
| 同步传播 commit 成功或错误 | trace/span、Agent Event Log、sidecar |

核心约束：`loop` 只 emit，`session` 是事实源唯一写者。

---

## 2. 模块结构

```text
event/
  README.md
  DESIGN.md
  TASKS.md
  mod.rs
  turn_event.rs      # 可提交 Turn 事实
  commit_handler.rs  # session adapter port
  pipeline.rs        # EventDispatcher
  tests.rs
```

---

## 3. 类型签名

```rust
pub enum TurnEvent {
    UserPromptCommitted {
        turn: u64,
        text: String,
    },
    AssistantFinalized {
        turn: u64,
        blocks: Vec<ContentBlock>,
    },
    ToolCallRecorded {
        turn: u64,
        call: ToolCall,
    },
    ToolResultRecorded {
        turn: u64,
        result: ToolResult,
    },
    CompactionApplied {
        turn: u64,
        compaction_kind: TurnCompactionKind,
        compaction_save_id: Option<String>,
        excluded_item_ids: Vec<String>,
        before_tokens: Option<u64>,
        after_tokens: Option<u64>,
    },
}

impl TurnEvent {
    pub fn turn(&self) -> u64;
}

pub trait CommitHandler: Send + Sync {
    fn commit(&self, event: &TurnEvent) -> anyhow::Result<()>;
}

pub struct EventDispatcher {
    commit: Arc<dyn CommitHandler>,
}

impl EventDispatcher {
    pub fn new(commit: Arc<dyn CommitHandler>) -> Self;
    pub fn emit(&self, event: TurnEvent) -> anyhow::Result<()>;
}
```

---

## 4. 算法

```text
emit(event):
  commit_handler.commit(&event)?
  return Ok
```

没有可选阶段、注册表、block 分支或 fail-open 分支。

---

## 5. import 边界

```text
event → llm::protocol（ContentBlock）
event → tools（ToolCall / ToolResult）
event ↛ session

session → event::CommitHandler + TurnEvent
loop    → event::EventDispatcher
agent   → 组装 SessionCommitHandler
```

`event` 不依赖 `session`；具体 `SessionCommitHandler` 由 session 提供并在组合根注入。

---

## 6. 不变量

1. 所有当前 `TurnEvent` 都对应一个可持久化 SessionItem。
2. `emit` 成功意味着 commit 已同步完成。
3. commit 错误原样传播，不吞错、不重试、不伪造结果。
4. event 不写文件，具体存储只由 session 实现。
5. ToolCall / ToolResult 直接复用 tools canonical 类型，不复制字段。
6. 当前不定义任何观测 identity、schema、存储路径或生命周期。

---

## 7. 错误策略

| 来源 | 行为 |
|---|---|
| `CommitHandler` 返回 `Err` | 传播到 Turn 边界 |
| Session 校验失败 | 传播原错误 |
| Session I/O 失败 | 传播原错误 |

---

## 8. 决策记录

| # | 决策 |
|---|---|
| 1 | 删除无独立语义的 Run 层，执行层级为 Session → Turn → Step → Tool round |
| 2 | event R1 只保留同步 Session commit 边界 |
| 3 | 删除无消费者的 hook、observe、registry 与可变 context |
| 4 | Agent Event Log、OTel、trace/span 与 bus 等到真实接入时重新设计 |

---

## 9. 后续能力门禁

出现 UI、sidecar、OTel exporter 或诊断消费者后，必须先回答：

- 消费的是事实、实时通知还是可丢失 telemetry；
- identity 与生命周期由谁拥有；
- 是否需要 span 层级、持久化、retention 或跨进程传播；
- 失败是否允许影响 Turn。

未回答前不增加通用 context、observer trait、bus 或 trace 文件格式。

---

## 10. 测试方向

- dispatcher 精确调用一次 commit handler；
- commit 错误传播；
- TurnEvent 变体都暴露正确 turn；
- SessionCommitHandler 端到端写入 Session Item Log。
