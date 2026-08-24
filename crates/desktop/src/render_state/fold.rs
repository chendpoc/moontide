use std::collections::BTreeSet;

use crate::{
    protocol::{DesktopMessage, DesktopMessageEnvelope, DesktopProtocolEvent, DesktopResponse},
    DesktopCommandError, DesktopRunState, DesktopSnapshot, ResyncReason, Seq,
};

use super::{model::*, projection::*};

impl RenderState {
    pub(crate) fn apply_message(&mut self, envelope: DesktopMessageEnvelope) -> RenderFoldResult {
        let epoch = envelope.connection_epoch;
        let seq = envelope.seq;
        match envelope.payload {
            DesktopMessage::Event(event) => self.apply_event(epoch, seq, event),
            DesktopMessage::Response(response) => self.apply_response(epoch, response),
            DesktopMessage::Command(_) => RenderFoldResult::Ignored,
        }
    }

    pub(crate) fn replace_snapshot(&mut self, snapshot: DesktopSnapshot) {
        let (messages, tools) = project_session(&snapshot.session);
        let active_calls = snapshot
            .active_assistant_calls
            .iter()
            .map(|call| AssistantDraftKey {
                turn: call.turn,
                llm_call_id: call.llm_call_id.clone(),
            })
            .collect::<BTreeSet<_>>();
        let had_dropped_draft = self
            .assistant_drafts
            .keys()
            .any(|key| !active_calls.contains(key));
        self.session = Some(snapshot.session);
        self.run = snapshot.state;
        self.messages = messages;
        self.tools = tools;
        self.approvals = snapshot
            .pending_approvals
            .into_iter()
            .map(|request| (request.id.clone(), ApprovalView { request }))
            .collect();
        self.assistant_drafts
            .retain(|key, _| active_calls.contains(key));
        self.finalized_calls.clear();
        self.stopped_report = None;
        self.delivery.last_seq = Some(Seq(snapshot.delivery.last_delivered_seq));
        self.delivery.awaiting_snapshot = false;
        self.delivery.resync_required = false;
        self.delivery.dropped_snapshots = snapshot.delivery.dropped_snapshots;
        self.delivery.buffered_events = snapshot.delivery.buffered_events;
        self.delivery.resync_reason = None;
        self.notices
            .retain(|notice| notice.kind != NoticeKind::Resync);
        if had_dropped_draft {
            self.add_notice(NoticeView {
                kind: NoticeKind::Resync,
                message: "resync removed an assistant draft whose call was no longer active".into(),
                recoverable: true,
                error_kind: None,
            });
        }
    }

    fn apply_response(
        &mut self,
        epoch: Option<crate::protocol::ConnectionEpoch>,
        response: DesktopResponse,
    ) -> RenderFoldResult {
        match response {
            DesktopResponse::SessionReady { snapshot } | DesktopResponse::Snapshot { snapshot } => {
                self.delivery.connection_epoch = epoch.or(self.delivery.connection_epoch);
                self.replace_snapshot(snapshot);
                RenderFoldResult::Applied
            }
            DesktopResponse::ApprovalAccepted { approval_id } => {
                self.approvals.remove(&approval_id);
                RenderFoldResult::Applied
            }
            DesktopResponse::ShutdownCompleted { report } => {
                self.run = DesktopRunState::Stopped;
                self.stopped_report = Some(report);
                RenderFoldResult::Applied
            }
            DesktopResponse::Rejected { error } => {
                self.add_notice(NoticeView {
                    kind: NoticeKind::Error,
                    message: error.to_string(),
                    recoverable: true,
                    error_kind: None,
                });
                RenderFoldResult::Applied
            }
            DesktopResponse::HandshakeAccepted { .. }
            | DesktopResponse::TurnAccepted { .. }
            | DesktopResponse::CancellationAccepted { .. } => RenderFoldResult::Ignored,
        }
    }

    fn apply_event(
        &mut self,
        epoch: Option<crate::protocol::ConnectionEpoch>,
        seq: Option<Seq>,
        event: DesktopProtocolEvent,
    ) -> RenderFoldResult {
        match self.accept_event_identity(epoch, seq) {
            Ok(()) => {}
            Err(result) => return result,
        }

        match event {
            DesktopProtocolEvent::TurnStarted { turn } => {
                self.run = DesktopRunState::Thinking { turn, step: 0 };
            }
            DesktopProtocolEvent::LlmCallStarted { turn, step, .. } => {
                self.run = DesktopRunState::Thinking { turn, step };
            }
            DesktopProtocolEvent::AssistantResponseSnapshot {
                turn,
                step,
                llm_call_id,
                update_index,
                snapshot,
            } => {
                let key = AssistantDraftKey { turn, llm_call_id };
                if self.finalized_calls.contains(&key) {
                    return RenderFoldResult::Ignored;
                }
                if let Some(previous) = self.assistant_drafts.get(&key) {
                    if update_index <= previous.update_index {
                        return RenderFoldResult::Ignored;
                    }
                }
                self.assistant_drafts.insert(
                    key.clone(),
                    AssistantDraftView {
                        key,
                        step,
                        update_index,
                        snapshot,
                    },
                );
            }
            DesktopProtocolEvent::ToolCall { turn, call } => {
                self.run = DesktopRunState::RunningTool {
                    turn,
                    tool_use_id: call.tool_use_id().to_owned(),
                    name: call.name().to_owned(),
                };
                self.tools.insert(
                    call.tool_use_id().to_owned(),
                    ToolView {
                        turn,
                        call,
                        result: None,
                    },
                );
            }
            DesktopProtocolEvent::ToolResult { result, .. } => {
                let tool_use_id = result.tool_use_id().to_owned();
                let Some(tool) = self.tools.get(&tool_use_id) else {
                    return self.request_resync(ResyncReason::EventGap);
                };
                if tool.call.name() != result.name() {
                    return self.request_resync(ResyncReason::EventGap);
                }
                if let Some(tool) = self.tools.get_mut(&tool_use_id) {
                    tool.result = Some(result);
                }
            }
            DesktopProtocolEvent::AssistantFinalized {
                turn,
                llm_call_id,
                blocks,
            } => {
                let key = AssistantDraftKey { turn, llm_call_id };
                if self.finalized_calls.contains(&key) {
                    return RenderFoldResult::Ignored;
                }
                self.assistant_drafts.remove(&key);
                self.messages.push(MessageView::Assistant { turn, blocks });
                self.finalized_calls.insert(key);
            }
            DesktopProtocolEvent::ApprovalRequested { request } => {
                let turn = request.turn;
                let request_id = request.id.clone();
                self.approvals
                    .insert(request_id.clone(), ApprovalView { request });
                self.run = DesktopRunState::WaitingApproval { turn, request_id };
            }
            DesktopProtocolEvent::StateChanged { state } => {
                self.run = state;
            }
            DesktopProtocolEvent::TurnFailed { turn, error } => {
                self.run = DesktopRunState::Failed {
                    turn: Some(turn),
                    error: error.clone(),
                };
                self.add_notice(error_notice(error));
            }
            DesktopProtocolEvent::ResyncRequired { reason } => {
                return self.request_resync(reason);
            }
            DesktopProtocolEvent::Stopped { report } => {
                self.run = DesktopRunState::Stopped;
                self.stopped_report = Some(report.clone());
                self.add_notice(NoticeView {
                    kind: NoticeKind::Stopped,
                    message: format!("desktop host stopped: {report:?}"),
                    recoverable: false,
                    error_kind: None,
                });
            }
            DesktopProtocolEvent::LlmCallEnded { .. } | DesktopProtocolEvent::TurnEnded { .. } => {}
            DesktopProtocolEvent::TurnCompleted { .. } => {
                self.run = DesktopRunState::Idle;
            }
        }

        RenderFoldResult::Applied
    }

    fn accept_event_identity(
        &mut self,
        epoch: Option<crate::protocol::ConnectionEpoch>,
        seq: Option<Seq>,
    ) -> Result<(), RenderFoldResult> {
        if let Some(epoch) = epoch {
            if let Some(current_epoch) = self.delivery.connection_epoch {
                if epoch < current_epoch {
                    return Err(RenderFoldResult::Ignored);
                }
                if epoch > current_epoch {
                    self.delivery.connection_epoch = Some(epoch);
                    self.delivery.last_seq = None;
                    self.delivery.awaiting_snapshot = true;
                    return Err(self.request_resync(ResyncReason::ExplicitRequest));
                }
            } else {
                self.delivery.connection_epoch = Some(epoch);
            }
        }

        if self.delivery.awaiting_snapshot {
            return Err(self.request_resync(ResyncReason::ExplicitRequest));
        }

        let Some(seq) = seq else {
            return Err(self.request_resync(ResyncReason::EventGap));
        };

        if let Some(last_seq) = self.delivery.last_seq {
            if seq <= last_seq {
                return Err(RenderFoldResult::Ignored);
            }
            if seq.0 != last_seq.0.saturating_add(1) {
                return Err(self.request_resync(ResyncReason::EventGap));
            }
        }
        self.delivery.last_seq = Some(seq);
        Ok(())
    }

    fn request_resync(&mut self, reason: ResyncReason) -> RenderFoldResult {
        self.delivery.resync_required = true;
        self.delivery.resync_reason = Some(reason.clone());
        if !self
            .notices
            .iter()
            .any(|notice| notice.kind == NoticeKind::Resync)
        {
            self.add_notice(NoticeView {
                kind: NoticeKind::Resync,
                message: format!("desktop state requires resync: {reason:?}"),
                recoverable: true,
                error_kind: None,
            });
        }
        RenderFoldResult::ResyncRequired
    }

    fn add_notice(&mut self, notice: NoticeView) {
        self.notices.push(notice);
    }

    pub(crate) fn record_command_error(&mut self, error: DesktopCommandError) {
        let recoverable = !matches!(
            &error,
            DesktopCommandError::ProtocolVersionUnsupported
                | DesktopCommandError::HandshakeRequired
                | DesktopCommandError::SessionNotStarted
                | DesktopCommandError::SessionAlreadyStarted
                | DesktopCommandError::Stopping
                | DesktopCommandError::Stopped
                | DesktopCommandError::EventStreamClosed
                | DesktopCommandError::Internal(_)
        );
        self.add_notice(NoticeView {
            kind: NoticeKind::Error,
            message: error.to_string(),
            recoverable,
            error_kind: None,
        });
    }
}
