use crate::{
    event::{DesktopEvent, DesktopEventEnvelope},
    state::{DesktopSnapshot, ShutdownReport},
    ApprovalRequest, DesktopCommandError, DesktopError, DesktopRunState, ResyncReason,
};

/// The first protocol version. D4 may negotiate this value during transport setup.
pub const DESKTOP_PROTOCOL_VERSION: ProtocolVersion = ProtocolVersion(1);

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ProtocolVersion(pub u16);

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct RequestId(pub String);

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ConnectionEpoch(pub u64);

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Seq(pub u64);

/// Pure UI intent. Host channels and reply handles are deliberately not part of this type.
#[derive(Debug, Clone, PartialEq, Eq)]
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionSelectionDto {
    New,
    Existing(String),
}

#[derive(Debug, Clone)]
pub enum DesktopResponse {
    HandshakeAccepted { protocol_version: ProtocolVersion },
    SessionReady { snapshot: DesktopSnapshot },
    TurnAccepted { turn: u64 },
    CancellationAccepted { turn: u64 },
    ApprovalAccepted { approval_id: String },
    Snapshot { snapshot: DesktopSnapshot },
    ShutdownCompleted { report: ShutdownReport },
    Rejected { error: DesktopCommandError },
}

/// Stable host-to-UI event boundary. Nested payloads remain canonical in R1.
#[derive(Debug, Clone)]
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
        snapshot: agent::ModelResponseSnapshot,
    },
    ToolCall {
        turn: u64,
        call: agent::ToolCall,
    },
    ToolResult {
        turn: u64,
        result: agent::ToolResult,
    },
    LlmCallEnded {
        turn: u64,
        step: u32,
        llm_call_id: String,
        outcome: agent::LlmCallOutcome,
    },
    AssistantFinalized {
        turn: u64,
        llm_call_id: String,
        blocks: Vec<agent::ContentBlock>,
    },
    TurnEnded {
        turn: u64,
    },
    StateChanged {
        state: DesktopRunState,
    },
    ApprovalRequested {
        request: ApprovalRequest,
    },
    TurnCompleted {
        turn: u64,
    },
    TurnFailed {
        turn: u64,
        error: DesktopError,
    },
    ResyncRequired {
        reason: ResyncReason,
    },
    Stopped {
        report: ShutdownReport,
    },
}

#[derive(Debug, Clone)]
pub enum DesktopMessage {
    Command(DesktopCommand),
    Response(DesktopResponse),
    Event(DesktopProtocolEvent),
}

#[derive(Debug, Clone)]
pub struct DesktopMessageEnvelope {
    pub protocol_version: ProtocolVersion,
    pub connection_epoch: Option<ConnectionEpoch>,
    pub request_id: Option<RequestId>,
    pub seq: Option<Seq>,
    pub payload: DesktopMessage,
}

impl DesktopProtocolEvent {
    pub(crate) fn from_event(event: DesktopEvent) -> Self {
        match event {
            DesktopEvent::StateChanged { state } => Self::StateChanged { state },
            DesktopEvent::Progress { event } => match event {
                agent::ProgressEvent::TurnStarted { turn } => Self::TurnStarted { turn },
                agent::ProgressEvent::LlmCallStarted {
                    turn,
                    step,
                    llm_call_id,
                } => Self::LlmCallStarted {
                    turn,
                    step,
                    llm_call_id,
                },
                agent::ProgressEvent::AssistantResponseSnapshot {
                    turn,
                    step,
                    llm_call_id,
                    update_index,
                    snapshot,
                } => Self::AssistantResponseSnapshot {
                    turn,
                    step,
                    llm_call_id,
                    update_index,
                    snapshot,
                },
                agent::ProgressEvent::ToolCall { turn, call } => Self::ToolCall { turn, call },
                agent::ProgressEvent::ToolResult { turn, result } => {
                    Self::ToolResult { turn, result }
                }
                agent::ProgressEvent::LlmCallEnded {
                    turn,
                    step,
                    llm_call_id,
                    outcome,
                } => Self::LlmCallEnded {
                    turn,
                    step,
                    llm_call_id,
                    outcome,
                },
                agent::ProgressEvent::AssistantFinalized {
                    turn,
                    llm_call_id,
                    blocks,
                } => Self::AssistantFinalized {
                    turn,
                    llm_call_id,
                    blocks,
                },
                agent::ProgressEvent::TurnEnded { turn } => Self::TurnEnded { turn },
            },
            DesktopEvent::ApprovalRequested { request } => Self::ApprovalRequested { request },
            DesktopEvent::TurnCompleted { turn, response: _ } => Self::TurnCompleted { turn },
            DesktopEvent::TurnFailed { turn, error } => Self::TurnFailed { turn, error },
            DesktopEvent::ResyncRequired { reason } => Self::ResyncRequired { reason },
            DesktopEvent::Stopped { report } => Self::Stopped { report },
        }
    }
}

impl DesktopMessageEnvelope {
    pub(crate) fn from_event_envelope(
        envelope: DesktopEventEnvelope,
        connection_epoch: ConnectionEpoch,
    ) -> Self {
        Self {
            protocol_version: DESKTOP_PROTOCOL_VERSION,
            connection_epoch: Some(connection_epoch),
            request_id: None,
            seq: Some(Seq(envelope.seq)),
            payload: DesktopMessage::Event(DesktopProtocolEvent::from_event(envelope.payload)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::DesktopEvent;

    // 场景：协议消息从内部事件 envelope 转换到 UI-facing envelope。
    // 预期：保留 seq，注入当前 connection epoch，并且不伪造 request_id。
    // 不变量：event correlation 与 command correlation 始终分离。
    #[test]
    fn event_adapter_preserves_delivery_identity() {
        let envelope = DesktopEventEnvelope {
            seq: 7,
            session_id: "session-1".into(),
            payload: DesktopEvent::StateChanged {
                state: DesktopRunState::Idle,
            },
        };

        let message = DesktopMessageEnvelope::from_event_envelope(envelope, ConnectionEpoch(3));

        assert_eq!(message.protocol_version, ProtocolVersion(1));
        assert_eq!(message.connection_epoch, Some(ConnectionEpoch(3)));
        assert_eq!(message.request_id, None);
        assert_eq!(message.seq, Some(Seq(7)));
        assert!(matches!(message.payload, DesktopMessage::Event(_)));
    }

    // 场景：内部 ProgressEvent 进入协议 adapter。
    // 预期：ProgressEvent 被展开为语义事件，而不是作为 agent::ProgressEvent wrapper 暴露。
    // 不变量：UI-facing event identity 和内部 progress projection 保持分层。
    #[test]
    fn progress_adapter_emits_semantic_event() {
        let envelope = DesktopEventEnvelope {
            seq: 2,
            session_id: "session-1".into(),
            payload: DesktopEvent::Progress {
                event: agent::ProgressEvent::TurnStarted { turn: 4 },
            },
        };

        let message = DesktopMessageEnvelope::from_event_envelope(envelope, ConnectionEpoch(1));

        assert!(matches!(
            message.payload,
            DesktopMessage::Event(DesktopProtocolEvent::TurnStarted { turn: 4 })
        ));
    }

    // 场景：UI 构造一个 command。
    // 预期：command 只包含 intent 数据，不携带 host channel 或 reply handle。
    // 不变量：transport correlation 由外层 envelope 负责。
    #[test]
    fn command_is_transport_independent_data() {
        let command = DesktopCommand::SubmitTurn {
            text: "hello".into(),
        };

        assert_eq!(
            command,
            DesktopCommand::SubmitTurn {
                text: "hello".into()
            }
        );
    }
}
