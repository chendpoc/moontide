use std::sync::{
    Arc,
    Mutex,
};

use agent_core::event::{
    AgentEventRecord,
    AgentEventRecorder,
};
use anyhow::{
    anyhow,
    Result,
};
use tokio::sync::mpsc;

use crate::DiagnosticPersistence;

pub(crate) const AGENT_EVENT_LOG_QUEUE_CAPACITY: usize = 256;

#[derive(Debug, Default)]
pub(crate) struct QueueStatus {
    pub(crate) state: QueueState,
    pub(crate) dropped_events: u64,
    pub(crate) last_error: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) enum QueueState {
    #[default]
    Running,
    Degraded,
    Stopped,
}

pub(crate) struct QueuedAgentEventRecorder {
    sender: mpsc::Sender<AgentEventRecord>,
    policy: DiagnosticPersistence,
    status: Arc<Mutex<QueueStatus>>,
}

impl QueuedAgentEventRecorder {
    pub(crate) fn new(policy: DiagnosticPersistence) -> (Self, mpsc::Receiver<AgentEventRecord>) {
        let (sender, receiver) = mpsc::channel(AGENT_EVENT_LOG_QUEUE_CAPACITY);
        let status = Arc::new(Mutex::new(QueueStatus::default()));
        (
            Self {
                sender,
                policy,
                status,
            },
            receiver,
        )
    }

    pub(crate) fn status(&self) -> Arc<Mutex<QueueStatus>> {
        Arc::clone(&self.status)
    }

    pub(crate) fn sender(&self) -> mpsc::Sender<AgentEventRecord> {
        self.sender.clone()
    }
}

impl AgentEventRecorder for QueuedAgentEventRecorder {
    fn append(&self, record: AgentEventRecord) -> Result<()> {
        if !should_persist(self.policy, &record) {
            return Ok(());
        }

        // A failed diagnostic startup or stopped worker is fail-open: retain the
        // status for the host, but do not emit one hook error for every later event.
        if self
            .status
            .lock()
            .map(|status| status.state == QueueState::Stopped)
            .unwrap_or(true)
        {
            return Ok(());
        }

        match self.sender.try_send(record) {
            Ok(()) => Ok(()),
            Err(mpsc::error::TrySendError::Full(_)) => {
                if let Ok(mut status) = self.status.lock() {
                    status.state = QueueState::Degraded;
                    status.dropped_events = status.dropped_events.saturating_add(1);
                    status.last_error = Some("agent event log queue full; event dropped".into());
                }
                Ok(())
            }
            Err(mpsc::error::TrySendError::Closed(_)) => {
                if let Ok(mut status) = self.status.lock() {
                    status.state = QueueState::Stopped;
                    status.last_error = Some("agent event log worker channel closed".into());
                }
                Err(anyhow!("agent event log worker channel closed"))
            }
        }
    }
}

fn should_persist(policy: DiagnosticPersistence, record: &AgentEventRecord) -> bool {
    match policy {
        DiagnosticPersistence::Off => false,
        DiagnosticPersistence::Errors => is_error_record(record),
        DiagnosticPersistence::Normal => !matches!(
            record.kind.as_str(),
            "assistant_text" | "thinking" | "tool_use_update"
        ),
        DiagnosticPersistence::Debug => true,
    }
}

fn is_error_record(record: &AgentEventRecord) -> bool {
    match record.kind.as_str() {
        "llm_call" => record.payload["outcome"]["status"]
            .as_str()
            .is_some_and(|status| matches!(status, "failed" | "cancelled")),
        "tool_result" => record.payload["status"] != serde_json::json!("succeeded"),
        _ => false,
    }
}
