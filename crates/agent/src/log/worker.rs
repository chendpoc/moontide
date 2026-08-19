use std::sync::{Arc, Mutex};

use agent_core::event::AgentEventRecord;
use anyhow::{Context, Result};
use tokio::sync::{mpsc, oneshot};

use super::file_recorder::FileAgentEventRecorder;
use super::queued_recorder::{
    QueueState, QueueStatus, QueuedAgentEventRecorder, AGENT_EVENT_LOG_QUEUE_CAPACITY,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentEventLogState {
    Running,
    Degraded,
    Stopped,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentEventLogStatus {
    pub state: AgentEventLogState,
    pub queue_capacity: usize,
    pub queue_len: usize,
    pub dropped_events: u64,
    pub last_error: Option<String>,
}

pub struct AgentEventLogHandle {
    sender: mpsc::Sender<LogCommand>,
    queue_sender: mpsc::Sender<AgentEventRecord>,
    status: Arc<Mutex<QueueStatus>>,
}

impl AgentEventLogHandle {
    pub(crate) fn new(queued: &QueuedAgentEventRecorder, worker: WorkerHandle) -> Self {
        Self {
            sender: worker.sender,
            queue_sender: queued.sender(),
            status: queued.status(),
        }
    }

    pub async fn flush(&self) -> Result<()> {
        let (ack, completion) = oneshot::channel();
        if let Err(error) = self.sender.send(LogCommand::Flush { ack }).await {
            let message = format!("send agent event log flush command: {error}");
            mark_stopped(&self.status, message.clone());
            return Err(anyhow::anyhow!(message));
        }
        let result = match completion.await {
            Ok(result) => result,
            Err(error) => {
                let message = format!("await agent event log worker flush: {error}");
                mark_stopped(&self.status, message.clone());
                return Err(anyhow::anyhow!(message));
            }
        };
        result.map_err(anyhow::Error::msg)?;
        Ok(())
    }

    pub fn status(&self) -> AgentEventLogStatus {
        let queue_len = AGENT_EVENT_LOG_QUEUE_CAPACITY.saturating_sub(self.queue_sender.capacity());
        match self.status.lock() {
            Ok(status) => AgentEventLogStatus {
                state: map_state(status.state),
                queue_capacity: AGENT_EVENT_LOG_QUEUE_CAPACITY,
                queue_len,
                dropped_events: status.dropped_events,
                last_error: status.last_error.clone(),
            },
            Err(_) => AgentEventLogStatus {
                state: AgentEventLogState::Stopped,
                queue_capacity: AGENT_EVENT_LOG_QUEUE_CAPACITY,
                queue_len,
                dropped_events: 0,
                last_error: Some("agent event log status lock poisoned".into()),
            },
        }
    }
}

pub(crate) struct AgentEventLogWorker;

impl AgentEventLogWorker {
    pub(crate) fn start(
        receiver: mpsc::Receiver<AgentEventRecord>,
        recorder: FileAgentEventRecorder,
        status: Arc<Mutex<QueueStatus>>,
    ) -> Result<WorkerHandle> {
        let runtime = tokio::runtime::Handle::try_current()
            .context("AgentEventLogWorker requires a Tokio runtime")?;
        let (sender, commands) = mpsc::channel(8);
        runtime.spawn(run_worker(receiver, commands, recorder, status));
        Ok(WorkerHandle { sender })
    }
}

pub(crate) struct WorkerHandle {
    sender: mpsc::Sender<LogCommand>,
}

enum LogCommand {
    Flush {
        ack: oneshot::Sender<Result<(), String>>,
    },
}

async fn run_worker(
    mut receiver: mpsc::Receiver<AgentEventRecord>,
    mut commands: mpsc::Receiver<LogCommand>,
    mut recorder: FileAgentEventRecorder,
    status: Arc<Mutex<QueueStatus>>,
) {
    loop {
        tokio::select! {
            biased;
            command = commands.recv() => match command {
                Some(LogCommand::Flush { ack }) => {
                    while let Ok(record) = receiver.try_recv() {
                        if let Err(error) = recorder.append(record) {
                            mark_degraded(&status, format!("{error:#}"));
                        }
                    }
                    let result = recorder.flush().map_err(|error| format!("{error:#}"));
                    if let Err(error) = &result {
                        mark_degraded(&status, error.clone());
                    }
                    let _ = ack.send(result);
                }
                None => {
                    while let Ok(record) = receiver.try_recv() {
                        if let Err(error) = recorder.append(record) {
                            mark_degraded(&status, format!("{error:#}"));
                        }
                    }
                    break;
                }
            },
            record = receiver.recv() => match record {
                Some(record) => {
                    if let Err(error) = recorder.append(record) {
                        mark_degraded(&status, format!("{error:#}"));
                    }
                }
                None => break,
            },
        }
    }

    if let Err(error) = recorder.flush() {
        mark_stopped(
            &status,
            format!("flush agent event log worker on stop: {error:#}"),
        );
    } else {
        mark_stopped(&status, "agent event log worker stopped".into());
    }
}

fn mark_degraded(status: &Arc<Mutex<QueueStatus>>, error: String) {
    if let Ok(mut status) = status.lock() {
        if status.state != QueueState::Stopped {
            status.state = QueueState::Degraded;
        }
        status.last_error = Some(error);
    }
}

fn mark_stopped(status: &Arc<Mutex<QueueStatus>>, error: String) {
    if let Ok(mut status) = status.lock() {
        status.state = QueueState::Stopped;
        status.last_error = Some(error);
    }
}

fn map_state(state: QueueState) -> AgentEventLogState {
    match state {
        QueueState::Running => AgentEventLogState::Running,
        QueueState::Degraded => AgentEventLogState::Degraded,
        QueueState::Stopped => AgentEventLogState::Stopped,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Scenario: the worker command receiver is already closed when a host requests flush.
    // Expected: flush returns an error and status becomes Stopped with a diagnostic message.
    // Invariant: a failed lifecycle command cannot leave the worker falsely reported Running.
    #[tokio::test]
    async fn flush_send_failure_marks_worker_stopped() {
        let (sender, receiver) = mpsc::channel(1);
        drop(receiver);
        let (queue_sender, _queue_receiver) = mpsc::channel(1);
        let status = Arc::new(Mutex::new(QueueStatus::default()));
        let handle = AgentEventLogHandle {
            sender,
            queue_sender,
            status: Arc::clone(&status),
        };

        assert!(handle.flush().await.is_err());
        let status = status.lock().expect("status");
        assert_eq!(status.state, QueueState::Stopped);
        assert!(status
            .last_error
            .as_deref()
            .is_some_and(|error| error.contains("flush command")));
    }

    // Scenario: a flush command is accepted but its completion acknowledgement is dropped.
    // Expected: flush returns an error and status becomes Stopped.
    // Invariant: a worker that disappears after accepting a command is observable to its host.
    #[tokio::test]
    async fn flush_completion_failure_marks_worker_stopped() {
        let (sender, mut receiver) = mpsc::channel(1);
        tokio::spawn(async move {
            if let Some(LogCommand::Flush { ack }) = receiver.recv().await {
                drop(ack);
            }
        });
        let (queue_sender, _queue_receiver) = mpsc::channel(1);
        let status = Arc::new(Mutex::new(QueueStatus::default()));
        let handle = AgentEventLogHandle {
            sender,
            queue_sender,
            status: Arc::clone(&status),
        };

        assert!(handle.flush().await.is_err());
        let status = status.lock().expect("status");
        assert_eq!(status.state, QueueState::Stopped);
        assert!(status
            .last_error
            .as_deref()
            .is_some_and(|error| error.contains("worker flush")));
    }
}
