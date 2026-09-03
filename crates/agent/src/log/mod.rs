mod file_recorder;
mod queued_recorder;
mod worker;

pub(crate) use file_recorder::FileAgentEventRecorder;
pub(crate) use queued_recorder::QueuedAgentEventRecorder;
pub(crate) use worker::AgentEventLogWorker;
pub use worker::{
    AgentEventLogHandle,
    AgentEventLogState,
    AgentEventLogStatus,
};

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use agent_core::event::{
        AgentChannel,
        AgentEventRecord,
        AgentEventRecorder,
        AgentPhase,
        DeriveAgentEventHook,
        EventDispatcher,
        PipelineRegistry,
        TraceContext,
        TurnEvent,
    };
    use agent_core::session::SessionStore;
    use agent_core::tools::{
        ToolCall,
        ToolContent,
        ToolResult,
    };
    use serde_json::json;

    use super::file_recorder::{
        truncate_record,
        FileAgentEventRecorder,
        MAX_AGENT_EVENT_BYTES,
    };
    use super::queued_recorder::{
        QueueState,
        QueuedAgentEventRecorder,
        AGENT_EVENT_LOG_QUEUE_CAPACITY,
    };
    use super::worker::AgentEventLogWorker;
    use super::{
        AgentEventLogHandle,
        AgentEventLogState,
    };
    use crate::DiagnosticPersistence;

    fn record(run_id: &str, kind: &str, payload: serde_json::Value) -> AgentEventRecord {
        AgentEventRecord {
            id: format!("event-{kind}"),
            seq: None,
            run_id: run_id.to_owned(),
            turn: 1,
            phase: AgentPhase::PostLlm,
            channel: AgentChannel::Trace,
            kind: kind.to_owned(),
            ts: 1,
            payload,
            preview: None,
            truncated: None,
            original_bytes: None,
        }
    }

    // Scenario: normal diagnostic persistence receives lifecycle and snapshot-derived records.
    // Expected: normal keeps semantic lifecycle records and filters high-frequency snapshots.
    // Invariant: filtering happens before the bounded queue and does not count as a drop.
    #[test]
    fn normal_policy_filters_high_frequency_updates() {
        let (queued, mut receiver) = QueuedAgentEventRecorder::new(DiagnosticPersistence::Normal);
        queued
            .append(record("run-1", "turn_started", json!({})))
            .expect("lifecycle record should enqueue");
        queued
            .append(record("run-1", "thinking", json!({"body": "draft"})))
            .expect("filtered snapshot should be accepted");

        assert_eq!(
            receiver.try_recv().expect("lifecycle record").kind,
            "turn_started"
        );
        assert!(receiver.try_recv().is_err());
        assert_eq!(queued.status().lock().expect("status").dropped_events, 0);
    }

    // Scenario: the diagnostic worker is unavailable while a producer emits more records than the queue capacity.
    // Expected: try_send returns immediately, records are dropped, and the caller still sees success.
    // Invariant: diagnostic backpressure never propagates into the AgentLoop.
    #[test]
    fn queue_full_is_degraded_and_non_blocking() {
        let (queued, _receiver) = QueuedAgentEventRecorder::new(DiagnosticPersistence::Debug);
        for index in 0..AGENT_EVENT_LOG_QUEUE_CAPACITY {
            queued
                .append(record("run-1", &format!("event-{index}"), json!({})))
                .expect("queue fill should succeed");
        }
        queued
            .append(record("run-1", "overflow", json!({})))
            .expect("overflow should be fail-open");

        let status = queued.status();
        let status = status.lock().expect("status");
        assert_eq!(status.state, QueueState::Degraded);
        assert_eq!(status.dropped_events, 1);
    }

    // Scenario: a normal worker flushes one canonical Agent Event record.
    // Expected: the buffered JSONL writer persists the complete payload and assigns seq zero.
    // Invariant: persistence formatting happens in the worker/file lane, after queueing.
    #[tokio::test]
    async fn worker_flushes_buffered_record_in_order() {
        let root = tempfile::tempdir().expect("tempdir");
        let runs_dir = root.path().join("runs");
        let (queued, receiver) = QueuedAgentEventRecorder::new(DiagnosticPersistence::Debug);
        let status = queued.status();
        let recorder = FileAgentEventRecorder::new(&runs_dir, "run-1").expect("recorder");
        let path = recorder.path().to_path_buf();
        let worker = AgentEventLogWorker::start(receiver, recorder, status)
            .expect("worker should start in Tokio runtime");
        let handle = AgentEventLogHandle::new(&queued, worker);

        queued
            .append(record("run-1", "tool_result", json!({"body": "complete"})))
            .expect("record should enqueue");
        handle.flush().await.expect("flush should complete");

        let lines = std::fs::read_to_string(path).expect("read event log");
        let value: serde_json::Value = serde_json::from_str(lines.trim()).expect("parse JSONL");
        assert_eq!(value["seq"], 0);
        assert_eq!(value["payload"]["body"], "complete");
    }

    // Scenario: a queued record carries the wrong legacy runId for the file partition.
    // Expected: the worker exposes the write failure through status while flush remains explicit.
    // Invariant: a diagnostic write failure does not panic or become a Session commit failure.
    #[tokio::test]
    async fn worker_exposes_file_error_without_panicking() {
        let root = tempfile::tempdir().expect("tempdir");
        let runs_dir = root.path().join("runs");
        let (queued, receiver) = QueuedAgentEventRecorder::new(DiagnosticPersistence::Debug);
        let status = queued.status();
        let recorder = FileAgentEventRecorder::new(&runs_dir, "run-expected").expect("recorder");
        let worker = AgentEventLogWorker::start(receiver, recorder, status)
            .expect("worker should start in Tokio runtime");
        let handle = AgentEventLogHandle::new(&queued, worker);

        queued
            .append(record("run-other", "turn_started", json!({})))
            .expect("queueing should remain fail-open");
        handle.flush().await.expect("flush itself should complete");

        let status = handle.status();
        assert_eq!(status.state, AgentEventLogState::Degraded);
        assert!(status
            .last_error
            .as_deref()
            .is_some_and(|error| error.contains("runId mismatch")));
    }

    // Scenario: the derived Agent Event hook and Session Item Log receive the same committed event.
    // Expected: Session remains the fact source while the diagnostic worker persists its derived row.
    // Invariant: the diagnostic queue is post-commit and cannot replace or block Session commit.
    #[tokio::test]
    async fn derived_hook_persists_after_session_commit() {
        let root = tempfile::tempdir().expect("tempdir");
        let sessions_dir = root.path().join("sessions");
        let runs_dir = root.path().join("runs");
        let mut store = SessionStore::create(&sessions_dir, root.path().to_path_buf())
            .expect("session should be created");
        let session_id = store.header().session_id.clone();
        let run_id = "run-derived";

        let (queued, receiver) = QueuedAgentEventRecorder::new(DiagnosticPersistence::Normal);
        let status = queued.status();
        let recorder = FileAgentEventRecorder::new(&runs_dir, run_id).expect("recorder");
        let event_path = recorder.path().to_path_buf();
        let worker = AgentEventLogWorker::start(receiver, recorder, status)
            .expect("worker should start in Tokio runtime");
        let handle = AgentEventLogHandle::new(&queued, worker);
        let registry = PipelineRegistry::builder()
            .hook(Arc::new(DeriveAgentEventHook::new(queued)))
            .build_frozen()
            .expect("registry");
        let mut dispatcher = EventDispatcher::new(registry, TraceContext::new(run_id, &session_id));

        dispatcher
            .emit(
                &mut store,
                TurnEvent::UserPromptCommitted {
                    turn: 0,
                    text: "hello".into(),
                },
            )
            .expect("event should commit");
        let call = ToolCall::new("tool-1", "lookup", json!({"query": "rust"}))
            .expect("tool call should be created");
        dispatcher
            .emit(
                &mut store,
                TurnEvent::ToolCallRecorded {
                    turn: 0,
                    call: call.clone(),
                },
            )
            .expect("tool call should commit");
        dispatcher
            .emit(
                &mut store,
                TurnEvent::ToolResultRecorded {
                    turn: 0,
                    result: ToolResult::succeeded(
                        &call,
                        ToolContent::Json(json!({"items": [1, true]})),
                    ),
                },
            )
            .expect("tool result should commit");
        handle.flush().await.expect("diagnostic log should flush");

        let loaded = SessionStore::load(&sessions_dir, &session_id).expect("session should load");
        assert_eq!(loaded.items().len(), 3);
        let lines = std::fs::read_to_string(event_path).expect("read derived log");
        let values: Vec<_> = lines
            .lines()
            .map(|line| serde_json::from_str::<serde_json::Value>(line).expect("parse JSONL"))
            .collect();
        assert_eq!(values[0]["kind"], "user_prompt");
        assert_eq!(values[0]["payload"]["text"], "hello");
        assert_eq!(values[2]["kind"], "tool_result");
        assert_eq!(
            values[2]["payload"]["content"],
            json!({"type": "json", "value": {"items": [1, true]}})
        );
    }

    // Scenario: the worker constructor is called from a synchronous context.
    // Expected: startup is rejected instead of creating an unowned synchronous fallback.
    // Invariant: every diagnostic worker has Tokio runtime ownership.
    #[test]
    fn worker_requires_tokio_runtime() {
        let root = tempfile::tempdir().expect("tempdir");
        let (queued, receiver) = QueuedAgentEventRecorder::new(DiagnosticPersistence::Debug);
        let status = queued.status();
        let recorder =
            FileAgentEventRecorder::new(root.path().join("runs"), "run-1").expect("recorder");

        assert!(AgentEventLogWorker::start(receiver, recorder, status).is_err());
    }

    // Scenario: an active Agent Event file is reopened for the same legacy runId partition.
    // Expected: the next recorder continues seq without duplicating an existing row.
    // Invariant: diagnostic file identity and sequence remain partition-local and monotonic.
    #[test]
    fn file_recorder_resumes_sequence() {
        let root = tempfile::tempdir().expect("tempdir");
        let runs_dir = root.path().join("runs");
        let mut first = FileAgentEventRecorder::new(&runs_dir, "run-seq").expect("first recorder");
        first
            .append(record("run-seq", "turn_started", json!({})))
            .expect("first record should append");
        first.flush().expect("first recorder should flush");
        drop(first);

        let mut second =
            FileAgentEventRecorder::new(&runs_dir, "run-seq").expect("second recorder");
        let path = second.path().to_path_buf();
        second
            .append(record("run-seq", "turn_ended", json!({})))
            .expect("second record should append");
        second.flush().expect("second recorder should flush");

        let lines = std::fs::read_to_string(path).expect("read event log");
        let values: Vec<_> = lines
            .lines()
            .map(|line| serde_json::from_str::<serde_json::Value>(line).expect("parse JSONL"))
            .collect();
        assert_eq!(values.len(), 2);
        assert_eq!(values[0]["seq"], 0);
        assert_eq!(values[1]["seq"], 1);
    }

    // Scenario: a large derived payload reaches the file recorder.
    // Expected: persisted JSONL stays below 64 KiB and records the original byte count.
    // Invariant: truncation belongs to file persistence, not derive or queue stages.
    #[test]
    fn file_recorder_truncates_only_at_persistence_boundary() {
        let huge = "x".repeat(MAX_AGENT_EVENT_BYTES);
        let truncated = truncate_record(record("run-1", "user_prompt", json!({"text": huge})));
        let bytes = serde_json::to_vec(&truncated).expect("serialize truncated record");

        assert_eq!(truncated.truncated, Some(true));
        assert!(truncated.original_bytes.unwrap_or_default() > MAX_AGENT_EVENT_BYTES as u64);
        assert!(bytes.len() < MAX_AGENT_EVENT_BYTES);
    }
}
