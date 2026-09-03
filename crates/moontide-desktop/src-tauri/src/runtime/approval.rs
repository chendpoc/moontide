use std::collections::{
    HashMap,
    HashSet,
};
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::atomic::{
    AtomicU64,
    Ordering,
};
use std::sync::{
    Arc,
    Mutex,
};

use anyhow::{
    anyhow,
    Result,
};
use tokio::sync::oneshot;

use super::event::{
    DesktopEvent,
    EventBuffer,
};
use super::state::DesktopRunState;

pub type ApprovalId = String;

#[derive(Debug, Clone, PartialEq)]
pub struct ApprovalRequest {
    pub id: ApprovalId,
    pub turn: u64,
    pub call: agent::ToolCall,
    pub working_dir: PathBuf,
}

pub(crate) struct ApprovalBroker {
    next_id: AtomicU64,
    pending: Mutex<HashMap<ApprovalId, PendingApproval>>,
    resolved: Mutex<HashSet<ApprovalId>>,
    working_dir: PathBuf,
    session_id: Mutex<String>,
    current_turn: AtomicU64,
    state: Arc<Mutex<DesktopRunState>>,
    buffer: Arc<EventBuffer>,
}

struct PendingApproval {
    request: ApprovalRequest,
    sender: oneshot::Sender<agent::ToolApproval>,
}

impl ApprovalBroker {
    pub(crate) fn new(
        working_dir: PathBuf,
        session_id: String,
        state: Arc<Mutex<DesktopRunState>>,
        buffer: Arc<EventBuffer>,
    ) -> Self {
        Self {
            next_id: AtomicU64::new(1),
            pending: Mutex::new(HashMap::new()),
            resolved: Mutex::new(HashSet::new()),
            working_dir,
            session_id: Mutex::new(session_id),
            current_turn: AtomicU64::new(0),
            state,
            buffer,
        }
    }

    pub(crate) fn pending_requests(&self) -> Vec<ApprovalRequest> {
        let pending = lock_pending(&self.pending);
        let mut requests = pending
            .values()
            .map(|pending| pending.request.clone())
            .collect::<Vec<_>>();
        requests.sort_by(|left, right| left.id.cmp(&right.id));
        requests
    }

    pub(crate) fn set_session_id(&self, session_id: String) {
        *lock_session_id(&self.session_id) = session_id;
    }

    pub(crate) fn set_turn(&self, turn: u64) {
        self.current_turn.store(turn, Ordering::Relaxed);
    }

    pub(crate) fn approve(
        &self,
        request_id: &str,
    ) -> std::result::Result<(), super::command::DesktopCommandError> {
        self.resolve(request_id, agent::ToolApproval::Approved)
    }

    pub(crate) fn deny(
        &self,
        request_id: &str,
        reason: String,
    ) -> std::result::Result<(), super::command::DesktopCommandError> {
        self.resolve(request_id, agent::ToolApproval::Denied { reason })
    }

    pub(crate) fn cancel_all(&self) {
        let mut pending = lock_pending(&self.pending);
        let mut resolved = lock_resolved(&self.resolved);
        for (id, pending) in pending.drain() {
            resolved.insert(id);
            let _ = pending.sender.send(agent::ToolApproval::Cancelled);
        }
    }

    fn resolve(
        &self,
        request_id: &str,
        decision: agent::ToolApproval,
    ) -> std::result::Result<(), super::command::DesktopCommandError> {
        let pending = lock_pending(&self.pending).remove(request_id);
        let Some(pending) = pending else {
            return if lock_resolved(&self.resolved).contains(request_id) {
                Err(super::command::DesktopCommandError::ApprovalAlreadyResolved)
            } else {
                Err(super::command::DesktopCommandError::ApprovalNotFound)
            };
        };
        lock_resolved(&self.resolved).insert(request_id.to_owned());
        let next_state = match &decision {
            agent::ToolApproval::Approved => DesktopRunState::RunningTool {
                turn: pending.request.turn,
                tool_use_id: pending.request.call.tool_use_id().to_owned(),
                name: pending.request.call.name().to_owned(),
            },
            agent::ToolApproval::Denied { .. } | agent::ToolApproval::Cancelled => {
                DesktopRunState::Thinking {
                    turn: pending.request.turn,
                    step: 0,
                }
            }
        };
        *self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = next_state.clone();
        let session_id = lock_session_id(&self.session_id).clone();
        let _ = self.buffer.publish(
            &session_id,
            DesktopEvent::StateChanged { state: next_state },
        );
        pending
            .sender
            .send(decision)
            .map_err(|_| super::command::DesktopCommandError::ApprovalAlreadyResolved)
    }
}

impl agent::ToolApprovalHandler for ApprovalBroker {
    fn request<'a>(
        &'a self,
        call: &'a agent::ToolCall,
    ) -> Pin<Box<dyn Future<Output = Result<agent::ToolApproval>> + Send + 'a>> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed).to_string();
        let request = ApprovalRequest {
            id: id.clone(),
            turn: self.current_turn.load(Ordering::Relaxed),
            call: call.clone(),
            working_dir: self.working_dir.clone(),
        };
        let (sender, receiver) = oneshot::channel();
        lock_pending(&self.pending).insert(
            id,
            PendingApproval {
                request: request.clone(),
                sender,
            },
        );
        let session_id = lock_session_id(&self.session_id).clone();
        let state = DesktopRunState::WaitingApproval {
            turn: request.turn,
            request_id: request.id.clone(),
        };
        *self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = state.clone();
        let _ = self
            .buffer
            .publish(&session_id, DesktopEvent::StateChanged { state });
        let _ = self
            .buffer
            .publish(&session_id, DesktopEvent::ApprovalRequested { request });

        Box::pin(async move {
            receiver
                .await
                .map_err(|_| anyhow!("approval broker was closed"))
        })
    }
}

fn lock_pending(
    pending: &Mutex<HashMap<ApprovalId, PendingApproval>>,
) -> std::sync::MutexGuard<'_, HashMap<ApprovalId, PendingApproval>> {
    pending
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn lock_session_id(session_id: &Mutex<String>) -> std::sync::MutexGuard<'_, String> {
    session_id
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn lock_resolved(
    resolved: &Mutex<HashSet<ApprovalId>>,
) -> std::sync::MutexGuard<'_, HashSet<ApprovalId>> {
    resolved
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use agent::ToolApprovalHandler;

    use super::super::event::DesktopEventStream;
    use super::*;

    // 场景：ToolApprovalHandler 创建 pending request，随后 UI approve。
    // 预期：完整 ToolCall 只出现在 ApprovalRequested 事件，future 返回 Approved。
    #[tokio::test]
    async fn approval_request_resolves_by_request_id() {
        let buffer = EventBuffer::new(16);
        let broker = ApprovalBroker::new(
            PathBuf::from("/workspace"),
            "session".into(),
            Arc::new(Mutex::new(DesktopRunState::Thinking { turn: 0, step: 0 })),
            Arc::clone(&buffer),
        );
        let call = agent::ToolCall::new(
            "tool-1",
            "read_file",
            serde_json::json!({"path": "secret.txt"}),
        )
        .expect("valid call");
        let future = broker.request(&call);
        broker.approve("1").expect("approval should resolve");
        assert_eq!(
            broker.approve("1"),
            Err(crate::runtime::DesktopCommandError::ApprovalAlreadyResolved)
        );
        assert_eq!(
            future.await.expect("approval future"),
            agent::ToolApproval::Approved
        );

        let mut stream = DesktopEventStream::new(buffer);
        let _state_event = stream.recv().await.expect("approval state event");
        let event = stream.recv().await.expect("approval event");
        assert!(matches!(
            event.payload,
            DesktopEvent::ApprovalRequested { request } if request.call == call
        ));
    }
}
