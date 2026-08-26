//! Versioned, framework-independent wire contract for MoonTide Desktop.
//!
//! This module deliberately contains no Agent, Tauri, Tokio, or frontend types.
//! Runtime adapters convert their owned values to these DTOs at the process
//! boundary.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const DESKTOP_PROTOCOL_VERSION: ProtocolVersion = ProtocolVersion(1);
pub const MAX_FRAME_LENGTH: u32 = 16 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ProtocolVersion(pub u16);

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct RequestId(pub String);

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ConnectionEpoch(pub u64);

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Seq(pub u64);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DesktopCommand {
    Handshake,
    StartSession { selection: SessionSelectionDto },
    SubmitTurn { text: String },
    CancelTurn,
    Approve { approval_id: String },
    Deny { approval_id: String, reason: String },
    Snapshot,
    Shutdown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SessionSelectionDto {
    New,
    Existing { session_id: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DesktopCommandErrorCode {
    ProtocolVersionUnsupported,
    HandshakeRequired,
    SessionNotStarted,
    SessionAlreadyStarted,
    Busy,
    NoActiveTurn,
    ApprovalNotFound,
    ApprovalAlreadyResolved,
    Stopping,
    Stopped,
    EventStreamClosed,
    InvalidInput,
    Internal,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopCommandErrorDto {
    pub code: DesktopCommandErrorCode,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DesktopErrorKindDto {
    Configuration,
    Provider,
    Tool,
    Approval,
    Cancelled,
    Persistence,
    Internal,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopErrorDto {
    pub kind: DesktopErrorKindDto,
    pub message: String,
    pub recoverable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DesktopRunStateDto {
    Starting,
    Idle,
    Thinking {
        turn: u64,
        step: u32,
    },
    RunningTool {
        turn: u64,
        tool_use_id: String,
        name: String,
    },
    WaitingApproval {
        turn: u64,
        request_id: String,
    },
    Cancelling {
        turn: u64,
    },
    Failed {
        turn: Option<u64>,
        error: DesktopErrorDto,
    },
    Stopping,
    Stopped,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResyncReasonDto {
    EventGap,
    ProgressLoss,
    WorkerDegraded,
    ExplicitRequest,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeliveryStatusDto {
    pub last_delivered_seq: u64,
    pub resync_required: bool,
    pub dropped_snapshots: u64,
    pub buffered_events: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct ActiveAssistantCallDto {
    pub turn: u64,
    pub llm_call_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionSummaryDto {
    pub session_id: String,
    pub cwd: PathBuf,
    pub last_turn: Option<u64>,
    pub item_count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SessionItemDto {
    UserMessage {
        base: SessionItemBaseDto,
        text: String,
    },
    AssistantMessage {
        base: SessionItemBaseDto,
        blocks: Vec<ContentBlockDto>,
    },
    ToolCall {
        base: SessionItemBaseDto,
        call: ToolCallDto,
    },
    ToolResult {
        base: SessionItemBaseDto,
        result: ToolResultDto,
    },
    Compaction {
        base: SessionItemBaseDto,
        compaction_kind: CompactionKindDto,
        compaction_save_id: Option<String>,
        excluded_item_ids: Vec<String>,
        before_tokens: Option<u64>,
        after_tokens: Option<u64>,
    },
    CheckpointCreated {
        base: SessionItemBaseDto,
        checkpoint_id: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionItemBaseDto {
    pub id: String,
    pub seq: u64,
    pub session_id: String,
    pub turn: u64,
    pub at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CompactionKindDto {
    Prune,
    TailWindow,
    Summary,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SessionSnapshotDto {
    pub summary: SessionSummaryDto,
    pub items: Vec<SessionItemDto>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ApprovalRequestDto {
    pub id: String,
    pub turn: u64,
    pub call: ToolCallDto,
    pub working_dir: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DesktopSnapshotDto {
    pub session: SessionSnapshotDto,
    pub state: DesktopRunStateDto,
    pub pending_approvals: Vec<ApprovalRequestDto>,
    pub active_assistant_calls: Vec<ActiveAssistantCallDto>,
    pub delivery: DeliveryStatusDto,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ShutdownReportDto {
    pub cancelled_turn: Option<u64>,
    pub progress_flushed: bool,
    pub diagnostic_log_flushed: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DesktopResponse {
    HandshakeAccepted { protocol_version: ProtocolVersion },
    SessionReady { snapshot: DesktopSnapshotDto },
    TurnAccepted { turn: u64 },
    CancellationAccepted { turn: u64 },
    ApprovalAccepted { approval_id: String },
    Snapshot { snapshot: DesktopSnapshotDto },
    ShutdownCompleted { report: ShutdownReportDto },
    Rejected { error: DesktopCommandErrorDto },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DesktopProtocolEvent {
    TurnStarted {
        turn: u64,
    },
    LlmCallStarted {
        turn: u64,
        step: u32,
        llm_call_id: String,
    },
    AssistantResponseSnapshot {
        turn: u64,
        step: u32,
        llm_call_id: String,
        update_index: u32,
        snapshot: ModelResponseSnapshotDto,
    },
    ToolCall {
        turn: u64,
        call: ToolCallDto,
    },
    ToolResult {
        turn: u64,
        result: ToolResultDto,
    },
    LlmCallEnded {
        turn: u64,
        step: u32,
        llm_call_id: String,
        outcome: LlmCallOutcomeDto,
    },
    AssistantFinalized {
        turn: u64,
        llm_call_id: String,
        blocks: Vec<ContentBlockDto>,
    },
    TurnEnded {
        turn: u64,
    },
    StateChanged {
        state: DesktopRunStateDto,
    },
    ApprovalRequested {
        request: ApprovalRequestDto,
    },
    TurnCompleted {
        turn: u64,
    },
    TurnFailed {
        turn: u64,
        error: DesktopErrorDto,
    },
    ResyncRequired {
        reason: ResyncReasonDto,
    },
    Stopped {
        report: ShutdownReportDto,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DesktopMessage {
    Command { command: DesktopCommand },
    Response { response: DesktopResponse },
    Event { event: DesktopProtocolEvent },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DesktopMessageEnvelope {
    pub protocol_version: ProtocolVersion,
    pub connection_epoch: Option<ConnectionEpoch>,
    pub request_id: Option<RequestId>,
    pub seq: Option<Seq>,
    pub payload: DesktopMessage,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ModelResponseSnapshotDto {
    pub content: Vec<ContentBlockDto>,
    pub pending: Option<PendingBlockDto>,
    pub stop_reason: Option<StopReasonDto>,
    pub usage: Option<UsageDto>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PendingBlockDto {
    Text {
        text: String,
    },
    Thinking {
        thinking: String,
    },
    ToolUse {
        id: String,
        name: String,
        input_json: String,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ContentBlockDto {
    Text {
        text: String,
    },
    Thinking {
        thinking: String,
    },
    ToolUse {
        id: String,
        name: String,
        input: Value,
    },
    ToolResult {
        tool_use_id: String,
        content: ToolResultContentDto,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ToolResultContentDto {
    Text(String),
    Blocks(Vec<ContentBlockDto>),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StopReasonDto {
    EndTurn,
    ToolUse,
    MaxTokens,
    Other(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct UsageDto {
    pub input_tokens: u32,
    pub output_tokens: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ToolCallDto {
    pub tool_use_id: String,
    pub name: String,
    pub input: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolContentDto {
    Text(String),
    Json(Value),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolCancellationReasonDto {
    User,
    Parent,
    Hook,
    Disposed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolResultStatusDto {
    Succeeded,
    Failed { retryable: bool },
    InvalidArguments,
    UnknownTool,
    Denied,
    Cancelled { reason: ToolCancellationReasonDto },
    OutcomeUnknown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ToolResultDto {
    pub tool_use_id: String,
    pub name: String,
    pub status: ToolResultStatusDto,
    pub content: ToolContentDto,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LlmCallOutcomeDto {
    Succeeded {
        stop_reason: StopReasonDto,
        usage: Option<UsageDto>,
    },
    Failed {
        message: String,
    },
    Cancelled,
}

#[cfg(test)]
mod tests {
    use super::*;

    // 场景：一个前端 command envelope 在 wire JSON 中往返。
    // 预期：所有 correlation 字段和 command payload 保持不变。
    // 不变量：协议 DTO 不依赖 runtime ownership 类型，序列化不会丢失 request identity。
    #[test]
    fn command_envelope_round_trips() {
        let envelope = DesktopMessageEnvelope {
            protocol_version: DESKTOP_PROTOCOL_VERSION,
            connection_epoch: Some(ConnectionEpoch(3)),
            request_id: Some(RequestId("req-1".into())),
            seq: None,
            payload: DesktopMessage::Command {
                command: DesktopCommand::SubmitTurn {
                    text: "inspect the workspace".into(),
                },
            },
        };

        let encoded = serde_json::to_vec(&envelope).expect("protocol envelope should serialize");
        let decoded: DesktopMessageEnvelope =
            serde_json::from_slice(&encoded).expect("protocol envelope should deserialize");

        assert_eq!(decoded, envelope);
    }

    // 场景：assistant streaming snapshot 包含 text、thinking 和 pending tool-use。
    // 预期：前端能够区分完整 blocks 与 transient pending block。
    // 不变量：snapshot 是 wire view，不携带 Agent 或 SessionStore 类型。
    #[test]
    fn snapshot_event_preserves_transient_content() {
        let event = DesktopProtocolEvent::AssistantResponseSnapshot {
            turn: 2,
            step: 1,
            llm_call_id: "call-1".into(),
            update_index: 4,
            snapshot: ModelResponseSnapshotDto {
                content: vec![ContentBlockDto::Text {
                    text: "partial".into(),
                }],
                pending: Some(PendingBlockDto::ToolUse {
                    id: "tool-1".into(),
                    name: "read_file".into(),
                    input_json: "{\"path\":\"README.md\"}".into(),
                }),
                stop_reason: None,
                usage: None,
                model: Some("test-model".into()),
            },
        };

        let encoded = serde_json::to_vec(&event).expect("event should serialize");
        let decoded: DesktopProtocolEvent =
            serde_json::from_slice(&encoded).expect("event should deserialize");

        assert_eq!(decoded, event);
    }

    // 场景：protocol frame length guard 被读取端使用。
    // 预期：最大长度是固定协议常量，不由 UI 或 runtime 任意扩大。
    // 不变量：跨进程读端必须拥有明确的内存上限。
    #[test]
    fn frame_limit_is_bounded() {
        assert_eq!(MAX_FRAME_LENGTH, 16 * 1024 * 1024);
    }
}
