//! Transitional conversion seam for the pre-R3 Tauri tracer bullet.
//!
//! New Host consumers use [`crate::DesktopProtocolServer`]. This module remains public only until
//! the Tauri bridge moves to the protocol client; R6 removes the parallel in-process graph.

use agent_core::{
    llm::protocol::{ContentBlock, PendingBlock, StopReason, Usage},
    session::{CompactionKind, SessionItem, SessionItemBase},
    tools::{ToolCall, ToolContent, ToolResult, ToolResultStatus},
};
use desktop_protocol as wire;

use crate::{
    event::{DesktopEvent, DesktopEventEnvelope},
    protocol::{DesktopMessage, DesktopMessageEnvelope, DesktopProtocolEvent},
    ApprovalRequest, DesktopCommandError, DesktopError, DesktopErrorKind, DesktopRunState,
    DesktopSnapshot, ResyncReason, ShutdownReport,
};

pub fn envelope_to_wire(envelope: &DesktopMessageEnvelope) -> wire::DesktopMessageEnvelope {
    wire::DesktopMessageEnvelope {
        protocol_version: wire::ProtocolVersion(envelope.protocol_version.0),
        connection_epoch: envelope
            .connection_epoch
            .map(|epoch| wire::ConnectionEpoch(epoch.0)),
        request_id: envelope
            .request_id
            .as_ref()
            .map(|id| wire::RequestId(id.0.clone())),
        seq: envelope.seq.map(|seq| wire::Seq(seq.0)),
        payload: message_to_wire(&envelope.payload),
    }
}

pub(crate) fn event_envelope_to_wire(
    envelope: &DesktopEventEnvelope,
    connection_epoch: wire::ConnectionEpoch,
) -> wire::DesktopMessageEnvelope {
    wire::DesktopMessageEnvelope {
        protocol_version: wire::DESKTOP_PROTOCOL_VERSION,
        connection_epoch: Some(connection_epoch),
        request_id: None,
        seq: Some(wire::Seq(envelope.seq)),
        payload: wire::DesktopMessage::Event {
            event: desktop_event_to_wire(&envelope.payload),
        },
    }
}

pub fn snapshot_to_wire(snapshot: &DesktopSnapshot) -> wire::DesktopSnapshotDto {
    wire::DesktopSnapshotDto {
        session: session_snapshot_to_wire(&snapshot.session),
        state: run_state_to_wire(&snapshot.state),
        pending_approvals: snapshot
            .pending_approvals
            .iter()
            .map(approval_to_wire)
            .collect(),
        active_assistant_calls: snapshot
            .active_assistant_calls
            .iter()
            .map(|call| wire::ActiveAssistantCallDto {
                turn: call.turn,
                llm_call_id: call.llm_call_id.clone(),
            })
            .collect(),
        delivery: wire::DeliveryStatusDto {
            last_delivered_seq: snapshot.delivery.last_delivered_seq,
            resync_required: snapshot.delivery.resync_required,
            dropped_snapshots: snapshot.delivery.dropped_snapshots,
            buffered_events: snapshot.delivery.buffered_events,
        },
    }
}

pub fn command_error_to_wire(error: &DesktopCommandError) -> wire::DesktopCommandErrorDto {
    wire::DesktopCommandErrorDto {
        code: match error {
            DesktopCommandError::ProtocolVersionUnsupported => {
                wire::DesktopCommandErrorCode::ProtocolVersionUnsupported
            }
            DesktopCommandError::HandshakeRequired => {
                wire::DesktopCommandErrorCode::HandshakeRequired
            }
            DesktopCommandError::SessionNotStarted => {
                wire::DesktopCommandErrorCode::SessionNotStarted
            }
            DesktopCommandError::SessionAlreadyStarted => {
                wire::DesktopCommandErrorCode::SessionAlreadyStarted
            }
            DesktopCommandError::Busy => wire::DesktopCommandErrorCode::Busy,
            DesktopCommandError::NoActiveTurn => wire::DesktopCommandErrorCode::NoActiveTurn,
            DesktopCommandError::ApprovalNotFound => {
                wire::DesktopCommandErrorCode::ApprovalNotFound
            }
            DesktopCommandError::ApprovalAlreadyResolved => {
                wire::DesktopCommandErrorCode::ApprovalAlreadyResolved
            }
            DesktopCommandError::Stopping => wire::DesktopCommandErrorCode::Stopping,
            DesktopCommandError::Stopped => wire::DesktopCommandErrorCode::Stopped,
            DesktopCommandError::EventStreamClosed => {
                wire::DesktopCommandErrorCode::EventStreamClosed
            }
            DesktopCommandError::InvalidInput(_) => wire::DesktopCommandErrorCode::InvalidInput,
            DesktopCommandError::Internal(_) => wire::DesktopCommandErrorCode::Internal,
        },
        message: error.to_string(),
    }
}

fn message_to_wire(message: &DesktopMessage) -> wire::DesktopMessage {
    match message {
        DesktopMessage::Command(command) => wire::DesktopMessage::Command {
            command: command_to_wire(command),
        },
        DesktopMessage::Response(response) => wire::DesktopMessage::Response {
            response: response_to_wire(response),
        },
        DesktopMessage::Event(event) => wire::DesktopMessage::Event {
            event: protocol_event_to_wire(event),
        },
    }
}

fn command_to_wire(command: &crate::protocol::DesktopCommand) -> wire::DesktopCommand {
    match command {
        crate::protocol::DesktopCommand::Handshake => wire::DesktopCommand::Handshake,
        crate::protocol::DesktopCommand::StartSession { selection } => {
            wire::DesktopCommand::StartSession {
                selection: match selection {
                    crate::protocol::SessionSelectionDto::New => wire::SessionSelectionDto::New,
                    crate::protocol::SessionSelectionDto::Existing(session_id) => {
                        wire::SessionSelectionDto::Existing {
                            session_id: session_id.clone(),
                        }
                    }
                },
            }
        }
        crate::protocol::DesktopCommand::SubmitTurn { text } => {
            wire::DesktopCommand::SubmitTurn { text: text.clone() }
        }
        crate::protocol::DesktopCommand::CancelTurn => wire::DesktopCommand::CancelTurn,
        crate::protocol::DesktopCommand::Approve { approval_id } => wire::DesktopCommand::Approve {
            approval_id: approval_id.clone(),
        },
        crate::protocol::DesktopCommand::Deny {
            approval_id,
            reason,
        } => wire::DesktopCommand::Deny {
            approval_id: approval_id.clone(),
            reason: reason.clone(),
        },
        crate::protocol::DesktopCommand::Snapshot => wire::DesktopCommand::Snapshot,
        crate::protocol::DesktopCommand::Shutdown => wire::DesktopCommand::Shutdown,
    }
}

fn response_to_wire(response: &crate::protocol::DesktopResponse) -> wire::DesktopResponse {
    match response {
        crate::protocol::DesktopResponse::HandshakeAccepted { protocol_version } => {
            wire::DesktopResponse::HandshakeAccepted {
                protocol_version: wire::ProtocolVersion(protocol_version.0),
            }
        }
        crate::protocol::DesktopResponse::SessionReady { snapshot } => {
            wire::DesktopResponse::SessionReady {
                snapshot: snapshot_to_wire(snapshot),
            }
        }
        crate::protocol::DesktopResponse::TurnAccepted { turn } => {
            wire::DesktopResponse::TurnAccepted { turn: *turn }
        }
        crate::protocol::DesktopResponse::CancellationAccepted { turn } => {
            wire::DesktopResponse::CancellationAccepted { turn: *turn }
        }
        crate::protocol::DesktopResponse::ApprovalAccepted { approval_id } => {
            wire::DesktopResponse::ApprovalAccepted {
                approval_id: approval_id.clone(),
            }
        }
        crate::protocol::DesktopResponse::Snapshot { snapshot } => {
            wire::DesktopResponse::Snapshot {
                snapshot: snapshot_to_wire(snapshot),
            }
        }
        crate::protocol::DesktopResponse::ShutdownCompleted { report } => {
            wire::DesktopResponse::ShutdownCompleted {
                report: shutdown_to_wire(report),
            }
        }
        crate::protocol::DesktopResponse::Rejected { error } => wire::DesktopResponse::Rejected {
            error: command_error_to_wire(error),
        },
    }
}

fn protocol_event_to_wire(event: &DesktopProtocolEvent) -> wire::DesktopProtocolEvent {
    match event {
        DesktopProtocolEvent::TurnStarted { turn } => {
            wire::DesktopProtocolEvent::TurnStarted { turn: *turn }
        }
        DesktopProtocolEvent::LlmCallStarted {
            turn,
            step,
            llm_call_id,
        } => wire::DesktopProtocolEvent::LlmCallStarted {
            turn: *turn,
            step: *step,
            llm_call_id: llm_call_id.clone(),
        },
        DesktopProtocolEvent::AssistantResponseSnapshot {
            turn,
            step,
            llm_call_id,
            update_index,
            snapshot,
        } => wire::DesktopProtocolEvent::AssistantResponseSnapshot {
            turn: *turn,
            step: *step,
            llm_call_id: llm_call_id.clone(),
            update_index: *update_index,
            snapshot: model_snapshot_to_wire(snapshot),
        },
        DesktopProtocolEvent::ToolCall { turn, call } => wire::DesktopProtocolEvent::ToolCall {
            turn: *turn,
            call: tool_call_to_wire(call),
        },
        DesktopProtocolEvent::ToolResult { turn, result } => {
            wire::DesktopProtocolEvent::ToolResult {
                turn: *turn,
                result: tool_result_to_wire(result),
            }
        }
        DesktopProtocolEvent::LlmCallEnded {
            turn,
            step,
            llm_call_id,
            outcome,
        } => wire::DesktopProtocolEvent::LlmCallEnded {
            turn: *turn,
            step: *step,
            llm_call_id: llm_call_id.clone(),
            outcome: llm_outcome_to_wire(outcome),
        },
        DesktopProtocolEvent::AssistantFinalized {
            turn,
            llm_call_id,
            blocks,
        } => wire::DesktopProtocolEvent::AssistantFinalized {
            turn: *turn,
            llm_call_id: llm_call_id.clone(),
            blocks: blocks.iter().map(content_block_to_wire).collect(),
        },
        DesktopProtocolEvent::TurnEnded { turn } => {
            wire::DesktopProtocolEvent::TurnEnded { turn: *turn }
        }
        DesktopProtocolEvent::StateChanged { state } => wire::DesktopProtocolEvent::StateChanged {
            state: run_state_to_wire(state),
        },
        DesktopProtocolEvent::ApprovalRequested { request } => {
            wire::DesktopProtocolEvent::ApprovalRequested {
                request: approval_to_wire(request),
            }
        }
        DesktopProtocolEvent::TurnCompleted { turn } => {
            wire::DesktopProtocolEvent::TurnCompleted { turn: *turn }
        }
        DesktopProtocolEvent::TurnFailed { turn, error } => {
            wire::DesktopProtocolEvent::TurnFailed {
                turn: *turn,
                error: desktop_error_to_wire(error),
            }
        }
        DesktopProtocolEvent::ResyncRequired { reason } => {
            wire::DesktopProtocolEvent::ResyncRequired {
                reason: resync_reason_to_wire(reason),
            }
        }
        DesktopProtocolEvent::Stopped { report } => wire::DesktopProtocolEvent::Stopped {
            report: shutdown_to_wire(report),
        },
    }
}

fn desktop_event_to_wire(event: &DesktopEvent) -> wire::DesktopProtocolEvent {
    match event {
        DesktopEvent::StateChanged { state } => wire::DesktopProtocolEvent::StateChanged {
            state: run_state_to_wire(state),
        },
        DesktopEvent::Progress { event } => progress_event_to_wire(event),
        DesktopEvent::ApprovalRequested { request } => {
            wire::DesktopProtocolEvent::ApprovalRequested {
                request: approval_to_wire(request),
            }
        }
        DesktopEvent::TurnCompleted { turn, response: _ } => {
            wire::DesktopProtocolEvent::TurnCompleted { turn: *turn }
        }
        DesktopEvent::TurnFailed { turn, error } => wire::DesktopProtocolEvent::TurnFailed {
            turn: *turn,
            error: desktop_error_to_wire(error),
        },
        DesktopEvent::ResyncRequired { reason } => wire::DesktopProtocolEvent::ResyncRequired {
            reason: resync_reason_to_wire(reason),
        },
        DesktopEvent::Stopped { report } => wire::DesktopProtocolEvent::Stopped {
            report: shutdown_to_wire(report),
        },
    }
}

fn progress_event_to_wire(event: &agent::ProgressEvent) -> wire::DesktopProtocolEvent {
    match event {
        agent::ProgressEvent::TurnStarted { turn } => {
            wire::DesktopProtocolEvent::TurnStarted { turn: *turn }
        }
        agent::ProgressEvent::LlmCallStarted {
            turn,
            step,
            llm_call_id,
        } => wire::DesktopProtocolEvent::LlmCallStarted {
            turn: *turn,
            step: *step,
            llm_call_id: llm_call_id.clone(),
        },
        agent::ProgressEvent::AssistantResponseSnapshot {
            turn,
            step,
            llm_call_id,
            update_index,
            snapshot,
        } => wire::DesktopProtocolEvent::AssistantResponseSnapshot {
            turn: *turn,
            step: *step,
            llm_call_id: llm_call_id.clone(),
            update_index: *update_index,
            snapshot: model_snapshot_to_wire(snapshot),
        },
        agent::ProgressEvent::ToolCall { turn, call } => wire::DesktopProtocolEvent::ToolCall {
            turn: *turn,
            call: tool_call_to_wire(call),
        },
        agent::ProgressEvent::ToolResult { turn, result } => {
            wire::DesktopProtocolEvent::ToolResult {
                turn: *turn,
                result: tool_result_to_wire(result),
            }
        }
        agent::ProgressEvent::LlmCallEnded {
            turn,
            step,
            llm_call_id,
            outcome,
        } => wire::DesktopProtocolEvent::LlmCallEnded {
            turn: *turn,
            step: *step,
            llm_call_id: llm_call_id.clone(),
            outcome: llm_outcome_to_wire(outcome),
        },
        agent::ProgressEvent::AssistantFinalized {
            turn,
            llm_call_id,
            blocks,
        } => wire::DesktopProtocolEvent::AssistantFinalized {
            turn: *turn,
            llm_call_id: llm_call_id.clone(),
            blocks: blocks.iter().map(content_block_to_wire).collect(),
        },
        agent::ProgressEvent::TurnEnded { turn } => {
            wire::DesktopProtocolEvent::TurnEnded { turn: *turn }
        }
    }
}

fn session_snapshot_to_wire(snapshot: &agent::SessionSnapshot) -> wire::SessionSnapshotDto {
    wire::SessionSnapshotDto {
        summary: wire::SessionSummaryDto {
            session_id: snapshot.summary.session_id.clone(),
            cwd: snapshot.summary.cwd.clone(),
            last_turn: snapshot.summary.last_turn,
            item_count: snapshot.summary.item_count,
        },
        items: snapshot.items.iter().map(session_item_to_wire).collect(),
    }
}

fn session_item_to_wire(item: &SessionItem) -> wire::SessionItemDto {
    match item {
        SessionItem::UserMessage { base, text } => wire::SessionItemDto::UserMessage {
            base: session_item_base_to_wire(base),
            text: text.clone(),
        },
        SessionItem::AssistantMessage { base, blocks } => wire::SessionItemDto::AssistantMessage {
            base: session_item_base_to_wire(base),
            blocks: blocks.iter().map(content_block_to_wire).collect(),
        },
        SessionItem::ToolCall { base, call } => wire::SessionItemDto::ToolCall {
            base: session_item_base_to_wire(base),
            call: tool_call_to_wire(call),
        },
        SessionItem::ToolResult { base, result } => wire::SessionItemDto::ToolResult {
            base: session_item_base_to_wire(base),
            result: tool_result_to_wire(result),
        },
        SessionItem::Compaction {
            base,
            compaction_kind,
            compaction_save_id,
            excluded_item_ids,
            before_tokens,
            after_tokens,
        } => wire::SessionItemDto::Compaction {
            base: session_item_base_to_wire(base),
            compaction_kind: match compaction_kind {
                CompactionKind::Prune => wire::CompactionKindDto::Prune,
                CompactionKind::TailWindow => wire::CompactionKindDto::TailWindow,
                CompactionKind::Summary => wire::CompactionKindDto::Summary,
            },
            compaction_save_id: compaction_save_id.clone(),
            excluded_item_ids: excluded_item_ids.clone(),
            before_tokens: *before_tokens,
            after_tokens: *after_tokens,
        },
        SessionItem::CheckpointCreated {
            base,
            checkpoint_id,
        } => wire::SessionItemDto::CheckpointCreated {
            base: session_item_base_to_wire(base),
            checkpoint_id: checkpoint_id.clone(),
        },
    }
}

fn session_item_base_to_wire(base: &SessionItemBase) -> wire::SessionItemBaseDto {
    wire::SessionItemBaseDto {
        id: base.id.clone(),
        seq: base.seq,
        session_id: base.session_id.clone(),
        turn: base.turn,
        at: base.at.clone(),
    }
}

fn run_state_to_wire(state: &DesktopRunState) -> wire::DesktopRunStateDto {
    match state {
        DesktopRunState::Starting => wire::DesktopRunStateDto::Starting,
        DesktopRunState::Idle => wire::DesktopRunStateDto::Idle,
        DesktopRunState::Thinking { turn, step } => wire::DesktopRunStateDto::Thinking {
            turn: *turn,
            step: *step,
        },
        DesktopRunState::RunningTool {
            turn,
            tool_use_id,
            name,
        } => wire::DesktopRunStateDto::RunningTool {
            turn: *turn,
            tool_use_id: tool_use_id.clone(),
            name: name.clone(),
        },
        DesktopRunState::WaitingApproval { turn, request_id } => {
            wire::DesktopRunStateDto::WaitingApproval {
                turn: *turn,
                request_id: request_id.clone(),
            }
        }
        DesktopRunState::Cancelling { turn } => {
            wire::DesktopRunStateDto::Cancelling { turn: *turn }
        }
        DesktopRunState::Failed { turn, error } => wire::DesktopRunStateDto::Failed {
            turn: *turn,
            error: desktop_error_to_wire(error),
        },
        DesktopRunState::Stopping => wire::DesktopRunStateDto::Stopping,
        DesktopRunState::Stopped => wire::DesktopRunStateDto::Stopped,
    }
}

fn desktop_error_to_wire(error: &DesktopError) -> wire::DesktopErrorDto {
    wire::DesktopErrorDto {
        kind: match error.kind {
            DesktopErrorKind::Configuration => wire::DesktopErrorKindDto::Configuration,
            DesktopErrorKind::Provider => wire::DesktopErrorKindDto::Provider,
            DesktopErrorKind::Tool => wire::DesktopErrorKindDto::Tool,
            DesktopErrorKind::Approval => wire::DesktopErrorKindDto::Approval,
            DesktopErrorKind::Cancelled => wire::DesktopErrorKindDto::Cancelled,
            DesktopErrorKind::Persistence => wire::DesktopErrorKindDto::Persistence,
            DesktopErrorKind::Internal => wire::DesktopErrorKindDto::Internal,
        },
        message: error.message.clone(),
        recoverable: error.recoverable,
    }
}

fn resync_reason_to_wire(reason: &ResyncReason) -> wire::ResyncReasonDto {
    match reason {
        ResyncReason::EventGap => wire::ResyncReasonDto::EventGap,
        ResyncReason::ProgressLoss => wire::ResyncReasonDto::ProgressLoss,
        ResyncReason::WorkerDegraded => wire::ResyncReasonDto::WorkerDegraded,
        ResyncReason::ExplicitRequest => wire::ResyncReasonDto::ExplicitRequest,
    }
}

pub(crate) fn shutdown_to_wire(report: &ShutdownReport) -> wire::ShutdownReportDto {
    wire::ShutdownReportDto {
        cancelled_turn: report.cancelled_turn,
        progress_flushed: report.progress_flushed,
        diagnostic_log_flushed: report.diagnostic_log_flushed,
    }
}

fn approval_to_wire(request: &ApprovalRequest) -> wire::ApprovalRequestDto {
    wire::ApprovalRequestDto {
        id: request.id.clone(),
        turn: request.turn,
        call: tool_call_to_wire(&request.call),
        working_dir: request.working_dir.clone(),
    }
}

fn model_snapshot_to_wire(
    snapshot: &agent::ModelResponseSnapshot,
) -> wire::ModelResponseSnapshotDto {
    wire::ModelResponseSnapshotDto {
        content: snapshot.content.iter().map(content_block_to_wire).collect(),
        pending: snapshot.pending.as_ref().map(pending_block_to_wire),
        stop_reason: snapshot.stop_reason.as_ref().map(stop_reason_to_wire),
        usage: snapshot.usage.as_ref().map(usage_to_wire),
        model: snapshot.model.clone(),
    }
}

fn pending_block_to_wire(block: &PendingBlock) -> wire::PendingBlockDto {
    match block {
        PendingBlock::Text { text } => wire::PendingBlockDto::Text { text: text.clone() },
        PendingBlock::Thinking { thinking } => wire::PendingBlockDto::Thinking {
            thinking: thinking.clone(),
        },
        PendingBlock::ToolUse {
            id,
            name,
            input_json,
        } => wire::PendingBlockDto::ToolUse {
            id: id.clone(),
            name: name.clone(),
            input_json: input_json.clone(),
        },
    }
}

fn content_block_to_wire(block: &ContentBlock) -> wire::ContentBlockDto {
    match block {
        ContentBlock::Text { text } => wire::ContentBlockDto::Text { text: text.clone() },
        ContentBlock::Thinking { thinking } => wire::ContentBlockDto::Thinking {
            thinking: thinking.clone(),
        },
        ContentBlock::ToolUse { id, name, input } => wire::ContentBlockDto::ToolUse {
            id: id.clone(),
            name: name.clone(),
            input: input.clone(),
        },
        ContentBlock::ToolResult {
            tool_use_id,
            content,
        } => wire::ContentBlockDto::ToolResult {
            tool_use_id: tool_use_id.clone(),
            content: tool_result_content_to_wire(content),
        },
    }
}

fn tool_result_content_to_wire(
    content: &agent_core::llm::protocol::ToolResultContent,
) -> wire::ToolResultContentDto {
    use agent_core::llm::protocol::ToolResultContent;
    match content {
        ToolResultContent::Text(text) => wire::ToolResultContentDto::Text(text.clone()),
        ToolResultContent::Blocks(blocks) => {
            wire::ToolResultContentDto::Blocks(blocks.iter().map(content_block_to_wire).collect())
        }
    }
}

fn stop_reason_to_wire(reason: &StopReason) -> wire::StopReasonDto {
    match reason {
        StopReason::EndTurn => wire::StopReasonDto::EndTurn,
        StopReason::ToolUse => wire::StopReasonDto::ToolUse,
        StopReason::MaxTokens => wire::StopReasonDto::MaxTokens,
        StopReason::Other(value) => wire::StopReasonDto::Other(value.clone()),
    }
}

fn usage_to_wire(usage: &Usage) -> wire::UsageDto {
    wire::UsageDto {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
    }
}

fn tool_call_to_wire(call: &ToolCall) -> wire::ToolCallDto {
    wire::ToolCallDto {
        tool_use_id: call.tool_use_id().to_owned(),
        name: call.name().to_owned(),
        input: call.input().clone(),
    }
}

fn tool_result_to_wire(result: &ToolResult) -> wire::ToolResultDto {
    wire::ToolResultDto {
        tool_use_id: result.tool_use_id().to_owned(),
        name: result.name().to_owned(),
        status: tool_result_status_to_wire(result.status()),
        content: tool_content_to_wire(result.content()),
    }
}

fn tool_content_to_wire(content: &ToolContent) -> wire::ToolContentDto {
    match content {
        ToolContent::Text(text) => wire::ToolContentDto::Text(text.clone()),
        ToolContent::Json(value) => wire::ToolContentDto::Json(value.clone()),
    }
}

fn tool_result_status_to_wire(status: &ToolResultStatus) -> wire::ToolResultStatusDto {
    match status {
        ToolResultStatus::Succeeded => wire::ToolResultStatusDto::Succeeded,
        ToolResultStatus::Failed { retryable } => wire::ToolResultStatusDto::Failed {
            retryable: *retryable,
        },
        ToolResultStatus::InvalidArguments => wire::ToolResultStatusDto::InvalidArguments,
        ToolResultStatus::UnknownTool => wire::ToolResultStatusDto::UnknownTool,
        ToolResultStatus::Denied => wire::ToolResultStatusDto::Denied,
        ToolResultStatus::Cancelled { reason } => wire::ToolResultStatusDto::Cancelled {
            reason: match reason {
                agent_core::tools::ToolCancellationReason::User => {
                    wire::ToolCancellationReasonDto::User
                }
                agent_core::tools::ToolCancellationReason::Parent => {
                    wire::ToolCancellationReasonDto::Parent
                }
                agent_core::tools::ToolCancellationReason::Hook => {
                    wire::ToolCancellationReasonDto::Hook
                }
                agent_core::tools::ToolCancellationReason::Disposed => {
                    wire::ToolCancellationReasonDto::Disposed
                }
            },
        },
        ToolResultStatus::OutcomeUnknown => wire::ToolResultStatusDto::OutcomeUnknown,
    }
}

fn llm_outcome_to_wire(outcome: &agent::LlmCallOutcome) -> wire::LlmCallOutcomeDto {
    match outcome {
        agent::LlmCallOutcome::Succeeded { stop_reason, usage } => {
            wire::LlmCallOutcomeDto::Succeeded {
                stop_reason: stop_reason_to_wire(stop_reason),
                usage: usage.as_ref().map(usage_to_wire),
            }
        }
        agent::LlmCallOutcome::Failed { kind } => wire::LlmCallOutcomeDto::Failed {
            message: format!("{kind:?}"),
        },
        agent::LlmCallOutcome::Cancelled { .. } => wire::LlmCallOutcomeDto::Cancelled,
    }
}

#[cfg(test)]
mod tests {
    use crate::protocol::{ConnectionEpoch, DesktopMessage, Seq, DESKTOP_PROTOCOL_VERSION};

    use super::*;

    // 场景：idle 状态 event envelope 转成 wire JSON。
    // 预期：protocol version、seq 和 event kind 在 JSON 中保留。
    // 不变量：wire 模块不引入 runtime ownership 类型。
    #[test]
    fn idle_state_event_serializes_for_frontend() {
        let envelope = DesktopMessageEnvelope {
            protocol_version: DESKTOP_PROTOCOL_VERSION,
            connection_epoch: Some(ConnectionEpoch(1)),
            request_id: None,
            seq: Some(Seq(3)),
            payload: DesktopMessage::Event(DesktopProtocolEvent::StateChanged {
                state: DesktopRunState::Idle,
            }),
        };

        let wire_envelope = envelope_to_wire(&envelope);
        let json = serde_json::to_value(wire_envelope).expect("wire envelope should serialize");

        assert_eq!(json["protocol_version"], 1);
        assert_eq!(json["seq"], 3);
        assert_eq!(json["payload"]["kind"], "event");
        assert_eq!(json["payload"]["event"]["kind"], "state_changed");
    }

    // 场景：Host EventBuffer 的 Progress event 直接进入 independent wire envelope。
    // 预期：adapter 保留 buffer seq、注入 wire epoch，并输出语义 TurnStarted event。
    // 不变量：active Host path 不经过 desktop::protocol 的平行 event envelope。
    #[test]
    fn host_event_maps_directly_to_independent_wire_graph() {
        let envelope = DesktopEventEnvelope {
            seq: 11,
            session_id: "session-1".into(),
            payload: DesktopEvent::Progress {
                event: agent::ProgressEvent::TurnStarted { turn: 3 },
            },
        };

        let wire_envelope = event_envelope_to_wire(&envelope, wire::ConnectionEpoch(9));

        assert_eq!(
            wire_envelope.connection_epoch,
            Some(wire::ConnectionEpoch(9))
        );
        assert_eq!(wire_envelope.request_id, None);
        assert_eq!(wire_envelope.seq, Some(wire::Seq(11)));
        assert!(matches!(
            wire_envelope.payload,
            wire::DesktopMessage::Event {
                event: wire::DesktopProtocolEvent::TurnStarted { turn: 3 }
            }
        ));
    }
}
