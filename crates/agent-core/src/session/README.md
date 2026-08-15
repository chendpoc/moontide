# session

> **职责：** Session Item Log 的 append-only 事实源与唯一写者：存 user / assistant / tool 数据事实，保证四不变量，提供 create / load(resume) / append / fork。
> **状态：** **draft（待定稿）** —— 接口未定稿，§8 开放问题待架构师逐项确认后转定稿；定稿前不写实现。
> **关联：** [`docs/spec/context-composer.md`](../../../../docs/spec/context-composer.md) · [`docs/spec/agent-events.md`](../../../../docs/spec/agent-events.md) · [`../../README.md`](../../README.md) · [`UBIQUITOUS_LANGUAGE.md`](../../../../UBIQUITOUS_LANGUAGE.md)

---

## 1. 职责一句话

session 是 **Session Item Log 的唯一写者与事实源**：append-only 存 user / assistant / tool 事实，保证四不变量，提供 create / load(resume) / append / fork。**不做** materialize（归 context #7）、**不做** compile（归 prompt #6）——本模块只存事实，不编译。

---

## 2. 关键类型

```rust
// 条目基底：seq = 位置（连续性校验），id = 身份（跨条目引用，fork 后仍稳定）
pub struct SessionItemBase {
    pub id: String,          // UUID，跨条目引用 + fork 边界
    pub seq: u64,            // append 时分配，== 行号，断号即报错
    pub session_id: String,  // UUID
    pub turn: u64,
    pub at: String,          // ISO 8601
}

pub enum SessionItem {
    UserMessage      { base: SessionItemBase, text: String },
    // blocks 仅允许 Text / Thinking 变体；ToolUse / ToolResult 独立成条目（防双写）
    AssistantMessage { base: SessionItemBase, blocks: Vec<ContentBlock> },
    ToolInvocation   { base: SessionItemBase, tool_use_id: String, name: String, input: Value },
    ToolOutcome      { base: SessionItemBase, tool_use_id: String, content: ToolResultContent },
}

// header 外置，不进 log（元数据非可重放事件）
pub struct SessionHeader {
    pub version: u32,
    pub session_id: String,
    pub cwd: PathBuf,
    pub parent_session: Option<String>,  // fork 来源
    pub seed_len: u64,                   // fork 继承的日志行数
}
```

> `ContentBlock` / `ToolResultContent` / `Value` 复用 `crate::llm::protocol`，不重定义。

---

## 3. 公开方法

```rust
pub struct Session { /* header + 内存已加载 items */ }

impl Session {
    pub fn create(cwd: PathBuf) -> Result<Self>;           // 生成 header + 空 log
    pub fn load(session_id: &str) -> Result<Self>;         // resume：读 header → 逐行重放 → 校验 seq
    pub fn append(&mut self, item: SessionItem) -> Result<()>;  // 唯一写者：校验 → 冻结 → 落盘
    pub fn fork(&self, boundary: &str /* ItemId */) -> Result<String /* 新 SessionId */>;
    pub fn items(&self) -> impl Iterator<Item = &SessionItem>;   // 供 context.materialize 读
    pub fn header(&self) -> &SessionHeader;
}
```

错误用 `anyhow::Result`（存储 / 校验错误不需要 `LlmError` 那种 Recoverable / Unrecoverable 分类）。

存储 layout（文件名**待定**，见 §8 G）：

```text
.moontide/sessions/
├── {session_id}.meta.json   # header
└── {session_id}.log.jsonl    # NDJSON，每行一条 SessionItem
```

---

## 4. 不变量

1. **`seq == log.len()`**：append 时 seq 必须等于当前行数，断号 = 数据损坏 → `Err`。
2. **先校验后冻结**：可无损序列化才入队，入队后不可变。
3. **`AssistantMessage.blocks` 不得含 `ToolUse` / `ToolResult`**（否则与 ToolInvocation / ToolOutcome 双写）。
4. **header 不进 log**（元数据非可重放事件）。
5. **模型可见先落盘**：loop 侧契约，session 不强制（不依赖 loop）。

---

## 5. import 边界

```text
session
    └── crate::llm::protocol   （ContentBlock / ToolResultContent）

context (#7) → session.items()   （materialize 唯一出口）
loop (#8)     → session.append() （唯一写者）
```

- session **不** import agent / loop / prompt / context / event（契约层，只被上层依赖）。
- session 不依赖 `moontide-agent`（分层铁律）。

---

## 6. 决策记录（draft）

1. **SessionItem 细粒度**：tool 拆成独立 `ToolInvocation` / `ToolOutcome` 条目，materialize 时再合成。理由：`tool_use_id` 需要跨条目关联，且 `ToolOutcome` 可能是大 payload（未来 spill）。
2. **`seq` + `id` 双字段**：seq 是位置（fork 后重编），id 是身份（fork 后引用不失效）。跨条目引用用 id。
3. **materialize 归 context**：session 只给 `items()` 读取器，materialize 是 context #7 的「唯一出口」（`agent-core/README.md` §2 已定）。

---

## 7. 边界情况

| 场景 | 处理 |
|------|------|
| seq 断号（数据损坏） | `Err`，不 panic |
| 序列化失败 | `Err`（先校验后冻结） |
| fork 半截 turn | `Err`（粗校验：boundary 非某 turn 最后一条） |
| 空 session（无任何 item） | `load` 合法 |
| session_id 路径逃逸 | create 时校验 UUID 格式 |

---

## 8. 开放问题（待定稿，逐项确认后转定稿）

| # | 开放问题 | 草案倾向（**未定稿**） |
|---|---|---|
| A | 生命周期条目（SessionStart / TurnStart / TurnEnd）进不进 log | 不进，turn 已在 `base.turn`；生命周期归 Agent Event Log（event #5） |
| B | `seq` + `id` 双字段 vs 只留一个 | 都要 |
| C | materialize 归属 | context #7；session 只给 `items()` |
| D | 首版 item 种类 | 只 4 类；Compaction（#7）、Checkpoint（resume 后置）、Routing（#9）后置 |
| E | Artifact spill / ToolResultSummary | 后置；首版 ToolOutcome 完整存 `ToolResultContent` |
| F | fork 边界校验 | 首版粗校验（boundary 是某 turn 最后一条）；tool 配对闭合后置 |
| G | log 文件名 | `.log.jsonl`（与 `.meta.json` 成对）vs `<sessionId>.jsonl`；候选稿与 spec 不一致，待定 |
