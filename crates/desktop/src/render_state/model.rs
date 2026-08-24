use std::collections::{BTreeMap, BTreeSet};

use crate::{
    protocol::{ConnectionEpoch, Seq},
    ApprovalRequest, DesktopErrorKind, DesktopRunState, ResyncReason, ShutdownReport,
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
    pub(super) finalized_calls: BTreeSet<AssistantDraftKey>,
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
