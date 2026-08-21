#![allow(
    dead_code,
    reason = "RenderState fields are consumed by the D3 Iced shell"
)]

use std::collections::{BTreeMap, BTreeSet};

use crate::{
    protocol::{
        ConnectionEpoch, DesktopMessage, DesktopMessageEnvelope, DesktopProtocolEvent,
        DesktopResponse, Seq,
    },
    ApprovalRequest, DesktopCommandError, DesktopError, DesktopErrorKind, DesktopRunState,
    DesktopSnapshot, ResyncReason, ShutdownReport,
};

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct AssistantDraftKey {
    pub(crate) turn: u64,
    pub(crate) llm_call_id: String,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct AssistantDraftView {
    pub(crate) key: AssistantDraftKey,
    pub(crate) step: u32,
    pub(crate) update_index: u32,
    pub(crate) snapshot: agent::ModelResponseSnapshot,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ToolView {
    pub(crate) turn: u64,
    pub(crate) call: agent::ToolCall,
    pub(crate) result: Option<agent::ToolResult>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ApprovalView {
    pub(crate) request: ApprovalRequest,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum MessageView {
    User {
        turn: u64,
        text: String,
    },
    Assistant {
        turn: u64,
        blocks: Vec<agent::ContentBlock>,
    },
    ToolCall {
        turn: u64,
        call: agent::ToolCall,
    },
    ToolResult {
        turn: u64,
        result: agent::ToolResult,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum NoticeKind {
    Error,
    Resync,
    Stopped,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NoticeView {
    pub(crate) kind: NoticeKind,
    pub(crate) message: String,
    pub(crate) recoverable: bool,
    pub(crate) error_kind: Option<DesktopErrorKind>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DeliveryView {
    pub(crate) connection_epoch: Option<ConnectionEpoch>,
    pub(crate) last_seq: Option<Seq>,
    pub(crate) awaiting_snapshot: bool,
    pub(crate) resync_required: bool,
    pub(crate) dropped_snapshots: u64,
    pub(crate) buffered_events: usize,
    pub(crate) resync_reason: Option<ResyncReason>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RenderFoldResult {
    Applied,
    Ignored,
    ResyncRequired,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct RenderState {
    pub(crate) session: Option<agent::SessionSnapshot>,
    pub(crate) run: DesktopRunState,
    pub(crate) messages: Vec<MessageView>,
    pub(crate) assistant_drafts: BTreeMap<AssistantDraftKey, AssistantDraftView>,
    pub(crate) tools: BTreeMap<String, ToolView>,
    pub(crate) approvals: BTreeMap<String, ApprovalView>,
    pub(crate) notices: Vec<NoticeView>,
    pub(crate) delivery: DeliveryView,
    pub(crate) stopped_report: Option<ShutdownReport>,
    finalized_calls: BTreeSet<AssistantDraftKey>,
}

impl Default for RenderState {
    fn default() -> Self {
        Self {
            session: None,
            run: DesktopRunState::Starting,
            messages: Vec::new(),
            assistant_drafts: BTreeMap::new(),
            tools: BTreeMap::new(),
            approvals: BTreeMap::new(),
            notices: Vec::new(),
            delivery: DeliveryView {
                connection_epoch: None,
                last_seq: None,
                awaiting_snapshot: false,
                resync_required: false,
                dropped_snapshots: 0,
                buffered_events: 0,
                resync_reason: None,
            },
            stopped_report: None,
            finalized_calls: BTreeSet::new(),
        }
    }
}

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
        epoch: Option<ConnectionEpoch>,
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
        epoch: Option<ConnectionEpoch>,
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
        epoch: Option<ConnectionEpoch>,
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

fn error_notice(error: DesktopError) -> NoticeView {
    NoticeView {
        kind: NoticeKind::Error,
        message: error.message,
        recoverable: error.recoverable,
        error_kind: Some(error.kind),
    }
}

fn project_session(
    snapshot: &agent::SessionSnapshot,
) -> (Vec<MessageView>, BTreeMap<String, ToolView>) {
    let mut messages = Vec::new();
    let mut tools = BTreeMap::new();

    for item in &snapshot.items {
        let turn = item.base().turn;
        match item {
            agent::SessionItem::UserMessage { text, .. } => {
                messages.push(MessageView::User {
                    turn,
                    text: text.clone(),
                });
            }
            agent::SessionItem::AssistantMessage { blocks, .. } => {
                messages.push(MessageView::Assistant {
                    turn,
                    blocks: blocks.clone(),
                });
            }
            agent::SessionItem::ToolCall { call, .. } => {
                tools.insert(
                    call.tool_use_id().to_owned(),
                    ToolView {
                        turn,
                        call: call.clone(),
                        result: None,
                    },
                );
                messages.push(MessageView::ToolCall {
                    turn,
                    call: call.clone(),
                });
            }
            agent::SessionItem::ToolResult { result, .. } => {
                if let Some(tool) = tools.get_mut(result.tool_use_id()) {
                    tool.result = Some(result.clone());
                }
                messages.push(MessageView::ToolResult {
                    turn,
                    result: result.clone(),
                });
            }
            agent::SessionItem::Compaction { .. }
            | agent::SessionItem::CheckpointCreated { .. } => {}
        }
    }

    (messages, tools)
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use agent_core::{
        llm::protocol::{ContentBlock, ModelResponseSnapshot},
        tools::ToolContent,
    };
    use serde_json::json;

    use super::*;
    use crate::protocol::{DesktopMessage, DESKTOP_PROTOCOL_VERSION};

    fn event(seq: u64, payload: DesktopProtocolEvent) -> DesktopMessageEnvelope {
        DesktopMessageEnvelope {
            protocol_version: DESKTOP_PROTOCOL_VERSION,
            connection_epoch: Some(ConnectionEpoch(1)),
            request_id: None,
            seq: Some(Seq(seq)),
            payload: DesktopMessage::Event(payload),
        }
    }

    fn snapshot(text: &str) -> ModelResponseSnapshot {
        ModelResponseSnapshot {
            content: vec![ContentBlock::Text {
                text: text.to_owned(),
            }],
            pending: None,
            stop_reason: None,
            usage: None,
            model: None,
        }
    }

    fn call(id: &str) -> agent::ToolCall {
        agent::ToolCall::new(id, "grep", json!({"pattern": "hello"})).expect("valid tool call")
    }

    fn desktop_snapshot() -> DesktopSnapshot {
        DesktopSnapshot {
            session: agent::SessionSnapshot {
                summary: agent::SessionSummary {
                    session_id: "session-1".into(),
                    cwd: PathBuf::from("/tmp"),
                    last_turn: None,
                    item_count: 0,
                },
                items: Vec::new(),
            },
            state: DesktopRunState::Idle,
            pending_approvals: Vec::new(),
            active_assistant_calls: Vec::new(),
            delivery: crate::DeliveryStatus {
                last_delivered_seq: 0,
                resync_required: true,
                dropped_snapshots: 1,
                buffered_events: 0,
            },
        }
    }

    // 场景：同一个 LLM call 发送多个 snapshot，并出现 seq gap。
    // 预期：snapshot 按 key 替换，旧 update 被忽略，gap 请求 resync。
    // 不变量：不追加重复 draft，也不猜测丢失的中间事件。
    #[test]
    fn snapshot_replaces_and_seq_gap_requests_resync() {
        let mut state = RenderState::default();
        let key = AssistantDraftKey {
            turn: 1,
            llm_call_id: "call-1".into(),
        };

        assert_eq!(
            state.apply_message(event(
                1,
                DesktopProtocolEvent::AssistantResponseSnapshot {
                    turn: 1,
                    step: 0,
                    llm_call_id: "call-1".into(),
                    update_index: 1,
                    snapshot: snapshot("Hello"),
                }
            )),
            RenderFoldResult::Applied
        );
        assert_eq!(
            state.assistant_drafts[&key].snapshot.content,
            snapshot("Hello").content
        );

        assert_eq!(
            state.apply_message(event(
                2,
                DesktopProtocolEvent::AssistantResponseSnapshot {
                    turn: 1,
                    step: 0,
                    llm_call_id: "call-1".into(),
                    update_index: 0,
                    snapshot: snapshot("stale"),
                }
            )),
            RenderFoldResult::Ignored
        );
        assert_eq!(
            state.assistant_drafts[&key].snapshot.content,
            snapshot("Hello").content
        );

        assert_eq!(
            state.apply_message(event(4, DesktopProtocolEvent::TurnEnded { turn: 1 },)),
            RenderFoldResult::ResyncRequired
        );
        assert!(state.delivery.resync_required);
    }

    // 场景：assistant finalized 到达后再次收到同一 call 的 snapshot/finalized。
    // 预期：draft 被移除，历史只增加一条 finalized message，重复事件被忽略。
    // 不变量：finalized call 不会重新显示 transient draft。
    #[test]
    fn finalized_call_is_removed_and_not_reopened() {
        let mut state = RenderState::default();
        state.apply_message(event(
            1,
            DesktopProtocolEvent::AssistantResponseSnapshot {
                turn: 1,
                step: 0,
                llm_call_id: "call-1".into(),
                update_index: 1,
                snapshot: snapshot("done"),
            },
        ));
        assert_eq!(
            state.apply_message(event(
                2,
                DesktopProtocolEvent::AssistantFinalized {
                    turn: 1,
                    llm_call_id: "call-1".into(),
                    blocks: vec![ContentBlock::Text {
                        text: "done".into()
                    }],
                },
            )),
            RenderFoldResult::Applied
        );
        assert!(state.assistant_drafts.is_empty());
        assert_eq!(state.messages.len(), 1);
        assert_eq!(
            state.apply_message(event(
                3,
                DesktopProtocolEvent::AssistantResponseSnapshot {
                    turn: 1,
                    step: 0,
                    llm_call_id: "call-1".into(),
                    update_index: 2,
                    snapshot: snapshot("again"),
                },
            )),
            RenderFoldResult::Ignored
        );
        assert!(state.assistant_drafts.is_empty());
        assert_eq!(state.messages.len(), 1);
    }

    // 场景：ToolResult 没有已知的 ToolCall，或名称与 ToolCall 不一致。
    // 预期：不创建孤立 ToolView，并请求 resync。
    // 不变量：UI 不猜测工具事实，也不把未知结果显示为成功。
    #[test]
    fn orphan_tool_result_requests_resync() {
        let mut state = RenderState::default();
        let unknown = agent::ToolResult::succeeded(&call("call-1"), ToolContent::Text("ok".into()));

        assert_eq!(
            state.apply_message(event(
                1,
                DesktopProtocolEvent::ToolResult {
                    turn: 1,
                    result: unknown,
                },
            )),
            RenderFoldResult::ResyncRequired
        );
        assert!(state.tools.is_empty());
        assert!(state.delivery.resync_required);
    }

    // 场景：Host 返回完整 DesktopSnapshot 作为 resync 基线。
    // 预期：替换 history/run/approval/delivery，只保留仍 active 的 transient draft。
    // 不变量：snapshot 成为新的 UI 基线，不 replay 已无法证明 active 的旧 draft。
    #[test]
    fn snapshot_replaces_render_baseline() {
        let mut state = RenderState::default();
        state.apply_message(event(
            1,
            DesktopProtocolEvent::AssistantResponseSnapshot {
                turn: 1,
                step: 0,
                llm_call_id: "call-1".into(),
                update_index: 1,
                snapshot: snapshot("transient"),
            },
        ));
        let result = state.apply_message(DesktopMessageEnvelope {
            protocol_version: DESKTOP_PROTOCOL_VERSION,
            connection_epoch: Some(ConnectionEpoch(1)),
            request_id: None,
            seq: None,
            payload: DesktopMessage::Response(DesktopResponse::Snapshot {
                snapshot: desktop_snapshot(),
            }),
        });

        assert_eq!(result, RenderFoldResult::Applied);
        assert!(state.session.is_some());
        assert!(state.assistant_drafts.is_empty());
        assert_eq!(state.run, DesktopRunState::Idle);
        assert_eq!(state.delivery.last_seq, Some(Seq(0)));
        assert!(!state.delivery.resync_required);

        let report = ShutdownReport {
            cancelled_turn: Some(1),
            progress_flushed: true,
            diagnostic_log_flushed: true,
        };
        assert_eq!(
            state.apply_message(event(
                1,
                DesktopProtocolEvent::Stopped {
                    report: report.clone(),
                },
            )),
            RenderFoldResult::Applied
        );
        assert_eq!(state.stopped_report, Some(report));
    }

    // 场景：resync 时本地有两个 transient draft，但 Host 只确认其中一个 call 仍 active。
    // 预期：保留 active draft，删除无法证明 active 的 draft，并显示可恢复 notice。
    // 不变量：snapshot 不把未知 transient 内容重新写入 Session history。
    #[test]
    fn snapshot_preserves_only_active_drafts() {
        let mut state = RenderState::default();
        for (seq, call_id) in [(1, "call-1"), (2, "call-2")] {
            assert_eq!(
                state.apply_message(event(
                    seq,
                    DesktopProtocolEvent::AssistantResponseSnapshot {
                        turn: 1,
                        step: 0,
                        llm_call_id: call_id.into(),
                        update_index: 0,
                        snapshot: snapshot(call_id),
                    },
                )),
                RenderFoldResult::Applied
            );
        }

        let mut baseline = desktop_snapshot();
        baseline.active_assistant_calls = vec![crate::ActiveAssistantCall {
            turn: 1,
            llm_call_id: "call-1".into(),
        }];
        let result = state.apply_message(DesktopMessageEnvelope {
            protocol_version: DESKTOP_PROTOCOL_VERSION,
            connection_epoch: Some(ConnectionEpoch(1)),
            request_id: None,
            seq: None,
            payload: DesktopMessage::Response(DesktopResponse::Snapshot { snapshot: baseline }),
        });

        assert_eq!(result, RenderFoldResult::Applied);
        assert!(state.assistant_drafts.contains_key(&AssistantDraftKey {
            turn: 1,
            llm_call_id: "call-1".into(),
        }));
        assert!(!state.assistant_drafts.contains_key(&AssistantDraftKey {
            turn: 1,
            llm_call_id: "call-2".into(),
        }));
        assert!(state
            .notices
            .iter()
            .any(|notice| notice.kind == NoticeKind::Resync && notice.recoverable));
    }

    // 场景：已有连接收到更高 connection_epoch 的事件，但新连接尚未发送 snapshot。
    // 预期：事件不被折叠，UI 标记等待 snapshot；snapshot 到达后才接受新 epoch 事件。
    // 不变量：新连接不会把缺失的历史事件混入旧 RenderState，也不会以 seq=1 绕过基线。
    #[test]
    fn new_epoch_requires_snapshot_before_events() {
        let mut state = RenderState::default();
        assert_eq!(
            state.apply_message(event(1, DesktopProtocolEvent::TurnStarted { turn: 1 },)),
            RenderFoldResult::Applied
        );

        let new_epoch_event = DesktopMessageEnvelope {
            protocol_version: DESKTOP_PROTOCOL_VERSION,
            connection_epoch: Some(ConnectionEpoch(2)),
            request_id: None,
            seq: Some(Seq(1)),
            payload: DesktopMessage::Event(DesktopProtocolEvent::TurnStarted { turn: 2 }),
        };
        assert_eq!(
            state.apply_message(new_epoch_event),
            RenderFoldResult::ResyncRequired
        );
        assert_eq!(state.run, DesktopRunState::Thinking { turn: 1, step: 0 });
        assert!(state.delivery.awaiting_snapshot);

        let snapshot = DesktopMessageEnvelope {
            protocol_version: DESKTOP_PROTOCOL_VERSION,
            connection_epoch: Some(ConnectionEpoch(2)),
            request_id: None,
            seq: None,
            payload: DesktopMessage::Response(DesktopResponse::Snapshot {
                snapshot: desktop_snapshot(),
            }),
        };
        assert_eq!(state.apply_message(snapshot), RenderFoldResult::Applied);
        assert!(!state.delivery.awaiting_snapshot);
        assert_eq!(
            state.apply_message(DesktopMessageEnvelope {
                protocol_version: DESKTOP_PROTOCOL_VERSION,
                connection_epoch: Some(ConnectionEpoch(2)),
                request_id: None,
                seq: Some(Seq(1)),
                payload: DesktopMessage::Event(DesktopProtocolEvent::TurnStarted { turn: 2 }),
            }),
            RenderFoldResult::Applied
        );
        assert_eq!(state.run, DesktopRunState::Thinking { turn: 2, step: 0 });
    }

    // 场景：一轮 turn 已经发送 TurnCompleted，但成功路径没有额外 StateChanged(Idle)。
    // 预期：RenderState 将 loading 状态折叠回 Idle。
    // 不变量：UI 不会因忽略 lifecycle completion 而永久显示忙碌状态。
    #[test]
    fn turn_completed_returns_to_idle() {
        let mut state = RenderState::default();
        assert_eq!(
            state.apply_message(event(
                1,
                DesktopProtocolEvent::StateChanged {
                    state: DesktopRunState::Thinking { turn: 1, step: 0 },
                },
            )),
            RenderFoldResult::Applied
        );
        assert_eq!(
            state.apply_message(event(2, DesktopProtocolEvent::TurnCompleted { turn: 1 },)),
            RenderFoldResult::Applied
        );
        assert_eq!(state.run, DesktopRunState::Idle);
    }

    // 场景：ToolCall、ApprovalRequested、ToolResult 和 TurnFailed 按顺序到达。
    // 预期：分别建立工具/approval projection，配对结果，并保留可恢复错误 notice。
    // 不变量：approval 只由 request id 标识，ToolResult 只更新已知 ToolCall。
    #[test]
    fn tool_approval_result_and_failure_are_projected() {
        let mut state = RenderState::default();
        let tool_call = call("call-1");
        assert_eq!(
            state.apply_message(event(
                1,
                DesktopProtocolEvent::ToolCall {
                    turn: 1,
                    call: tool_call.clone(),
                },
            )),
            RenderFoldResult::Applied
        );

        let approval = ApprovalRequest {
            id: "approval-1".into(),
            turn: 1,
            call: tool_call.clone(),
            working_dir: PathBuf::from("/tmp"),
        };
        assert_eq!(
            state.apply_message(event(
                2,
                DesktopProtocolEvent::ApprovalRequested { request: approval },
            )),
            RenderFoldResult::Applied
        );
        assert!(state.approvals.contains_key("approval-1"));
        assert_eq!(
            state.run,
            DesktopRunState::WaitingApproval {
                turn: 1,
                request_id: "approval-1".into()
            }
        );

        let accepted = DesktopMessageEnvelope {
            protocol_version: DESKTOP_PROTOCOL_VERSION,
            connection_epoch: Some(ConnectionEpoch(1)),
            request_id: Some(crate::RequestId("request-1".into())),
            seq: None,
            payload: DesktopMessage::Response(DesktopResponse::ApprovalAccepted {
                approval_id: "approval-1".into(),
            }),
        };
        assert_eq!(state.apply_message(accepted), RenderFoldResult::Applied);
        assert!(state.approvals.is_empty());

        let result = agent::ToolResult::succeeded(&tool_call, ToolContent::Text("ok".into()));
        assert_eq!(
            state.apply_message(event(
                3,
                DesktopProtocolEvent::ToolResult { turn: 1, result },
            )),
            RenderFoldResult::Applied
        );
        assert!(state.tools["call-1"].result.is_some());

        let error = crate::DesktopError {
            kind: crate::DesktopErrorKind::Tool,
            message: "tool failed after approval".into(),
            recoverable: true,
        };
        assert_eq!(
            state.apply_message(event(
                4,
                DesktopProtocolEvent::TurnFailed { turn: 1, error },
            )),
            RenderFoldResult::Applied
        );
        assert!(matches!(
            state.run,
            DesktopRunState::Failed { turn: Some(1), .. }
        ));
        assert!(state.notices.iter().any(|notice| {
            notice.kind == NoticeKind::Error
                && notice.error_kind == Some(crate::DesktopErrorKind::Tool)
        }));
    }

    // 场景：UI command 分别返回可继续处理的输入错误和不可恢复的 host lifecycle 错误。
    // 预期：notice 保留正确的 recoverable 语义，避免把 Stopped/内部错误显示为可重试。
    // 不变量：command error 只进入 UI notice，不改变 RenderState 的运行事实。
    #[test]
    fn command_error_notice_preserves_recoverability() {
        let mut state = RenderState::default();

        state.record_command_error(DesktopCommandError::InvalidInput("empty".into()));
        state.record_command_error(DesktopCommandError::Stopped);

        assert!(state.notices[0].recoverable);
        assert!(!state.notices[1].recoverable);
        assert_eq!(state.run, DesktopRunState::Starting);
    }
}
