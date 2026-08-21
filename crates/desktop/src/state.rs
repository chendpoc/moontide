#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DesktopRunState {
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
        error: DesktopError,
    },
    Stopping,
    Stopped,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DesktopError {
    pub kind: DesktopErrorKind,
    pub message: String,
    pub recoverable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DesktopErrorKind {
    Configuration,
    Provider,
    Tool,
    Approval,
    Cancelled,
    Persistence,
    Internal,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResyncReason {
    EventGap,
    ProgressLoss,
    WorkerDegraded,
    ExplicitRequest,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeliveryStatus {
    pub last_delivered_seq: u64,
    pub resync_required: bool,
    pub dropped_snapshots: u64,
    pub buffered_events: usize,
}

/// Identifies an assistant call whose transient response may still be visible.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct ActiveAssistantCall {
    pub turn: u64,
    pub llm_call_id: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DesktopSnapshot {
    pub session: agent::SessionSnapshot,
    pub state: DesktopRunState,
    pub pending_approvals: Vec<crate::ApprovalRequest>,
    pub active_assistant_calls: Vec<ActiveAssistantCall>,
    pub delivery: DeliveryStatus,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShutdownReport {
    pub cancelled_turn: Option<u64>,
    pub progress_flushed: bool,
    pub diagnostic_log_flushed: bool,
}
