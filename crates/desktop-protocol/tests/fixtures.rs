use std::collections::BTreeSet;

use desktop_protocol::{
    DesktopCommand, DesktopMessage, DesktopMessageEnvelope, DesktopProtocolEvent, DesktopResponse,
    DESKTOP_PROTOCOL_VERSION,
};
use serde_json::Value;

const COMMAND_FIXTURES: &str = include_str!("fixtures/commands.json");
const RESPONSE_FIXTURES: &str = include_str!("fixtures/responses.json");
const EVENT_FIXTURES: &str = include_str!("fixtures/events.json");

fn decode_fixtures(source: &str) -> (Value, Vec<DesktopMessageEnvelope>) {
    let json: Value = serde_json::from_str(source).expect("fixture file should contain valid JSON");
    let envelopes = serde_json::from_value(json.clone())
        .expect("fixture JSON should conform to DesktopMessageEnvelope");
    (json, envelopes)
}

fn request_ids(envelopes: &[DesktopMessageEnvelope]) -> BTreeSet<&str> {
    envelopes
        .iter()
        .map(|envelope| {
            envelope
                .request_id
                .as_ref()
                .expect("command and response fixtures should have request_id")
                .0
                .as_str()
        })
        .collect()
}

fn command_kind(command: &DesktopCommand) -> &'static str {
    match command {
        DesktopCommand::Handshake => "handshake",
        DesktopCommand::StartSession { .. } => "start_session",
        DesktopCommand::SubmitTurn { .. } => "submit_turn",
        DesktopCommand::CancelTurn => "cancel_turn",
        DesktopCommand::Approve { .. } => "approve",
        DesktopCommand::Deny { .. } => "deny",
        DesktopCommand::Snapshot => "snapshot",
        DesktopCommand::Shutdown => "shutdown",
    }
}

fn response_kind(response: &DesktopResponse) -> &'static str {
    match response {
        DesktopResponse::HandshakeAccepted { .. } => "handshake_accepted",
        DesktopResponse::SessionReady { .. } => "session_ready",
        DesktopResponse::TurnAccepted { .. } => "turn_accepted",
        DesktopResponse::CancellationAccepted { .. } => "cancellation_accepted",
        DesktopResponse::ApprovalAccepted { .. } => "approval_accepted",
        DesktopResponse::Snapshot { .. } => "snapshot",
        DesktopResponse::ShutdownCompleted { .. } => "shutdown_completed",
        DesktopResponse::Rejected { .. } => "rejected",
    }
}

fn event_kind(event: &DesktopProtocolEvent) -> &'static str {
    match event {
        DesktopProtocolEvent::TurnStarted { .. } => "turn_started",
        DesktopProtocolEvent::LlmCallStarted { .. } => "llm_call_started",
        DesktopProtocolEvent::AssistantResponseSnapshot { .. } => "assistant_response_snapshot",
        DesktopProtocolEvent::ToolCall { .. } => "tool_call",
        DesktopProtocolEvent::ToolResult { .. } => "tool_result",
        DesktopProtocolEvent::LlmCallEnded { .. } => "llm_call_ended",
        DesktopProtocolEvent::AssistantFinalized { .. } => "assistant_finalized",
        DesktopProtocolEvent::TurnEnded { .. } => "turn_ended",
        DesktopProtocolEvent::StateChanged { .. } => "state_changed",
        DesktopProtocolEvent::ApprovalRequested { .. } => "approval_requested",
        DesktopProtocolEvent::TurnCompleted { .. } => "turn_completed",
        DesktopProtocolEvent::TurnFailed { .. } => "turn_failed",
        DesktopProtocolEvent::ResyncRequired { .. } => "resync_required",
        DesktopProtocolEvent::Stopped { .. } => "stopped",
    }
}

// 场景：非 Rust consumer 读取所有 Desktop command 的 committed JSON fixtures。
// 预期：fixtures 覆盖每个 command variant，往返 JSON 不改变 shape。
// 不变量：command 有 request_id、没有 seq；只有 handshake 可以没有 connection_epoch。
#[test]
fn command_fixtures_cover_v1_contract_and_identity() {
    let (json, envelopes) = decode_fixtures(COMMAND_FIXTURES);
    let mut kinds = BTreeSet::new();
    let mut request_ids = BTreeSet::new();

    for envelope in &envelopes {
        assert_eq!(envelope.protocol_version, DESKTOP_PROTOCOL_VERSION);
        let request_id = envelope
            .request_id
            .as_ref()
            .expect("command fixture should have request_id");
        assert!(!request_id.0.is_empty());
        assert!(request_ids.insert(request_id.0.as_str()));
        assert_eq!(envelope.seq, None);

        let DesktopMessage::Command { command } = &envelope.payload else {
            panic!("command fixture should contain a command payload");
        };
        if matches!(command, DesktopCommand::Handshake) {
            assert_eq!(envelope.connection_epoch, None);
        } else {
            assert!(envelope.connection_epoch.is_some());
        }
        kinds.insert(command_kind(command));
    }

    assert_eq!(
        kinds,
        BTreeSet::from([
            "approve",
            "cancel_turn",
            "deny",
            "handshake",
            "shutdown",
            "snapshot",
            "start_session",
            "submit_turn",
        ])
    );
    assert_eq!(
        serde_json::to_value(&envelopes).expect("command fixtures should serialize"),
        json
    );
}

// 场景：Host 或 transport adapter 产生所有 Desktop response 的 committed JSON fixtures。
// 预期：fixtures 覆盖每个 response variant，往返 JSON 不改变 shape。
// 不变量：response 回显 request_id、有 connection_epoch、没有 event seq。
#[test]
fn response_fixtures_cover_v1_contract_and_identity() {
    let (json, envelopes) = decode_fixtures(RESPONSE_FIXTURES);
    let (_, commands) = decode_fixtures(COMMAND_FIXTURES);
    let mut kinds = BTreeSet::new();
    let mut response_request_ids = BTreeSet::new();

    for envelope in &envelopes {
        assert_eq!(envelope.protocol_version, DESKTOP_PROTOCOL_VERSION);
        let request_id = envelope
            .request_id
            .as_ref()
            .expect("response fixture should have request_id");
        assert!(!request_id.0.is_empty());
        assert!(response_request_ids.insert(request_id.0.as_str()));
        assert!(envelope.connection_epoch.is_some());
        assert_eq!(envelope.seq, None);

        let DesktopMessage::Response { response } = &envelope.payload else {
            panic!("response fixture should contain a response payload");
        };
        kinds.insert(response_kind(response));
    }

    assert_eq!(response_request_ids, request_ids(&commands));

    assert_eq!(
        kinds,
        BTreeSet::from([
            "approval_accepted",
            "cancellation_accepted",
            "handshake_accepted",
            "rejected",
            "session_ready",
            "shutdown_completed",
            "snapshot",
            "turn_accepted",
        ])
    );
    assert_eq!(
        serde_json::to_value(&envelopes).expect("response fixtures should serialize"),
        json
    );
}

// 场景：Host event delivery 向非 Rust consumer 提供所有语义 event 的 JSON fixtures。
// 预期：fixtures 覆盖每个 event variant，seq 在同一 epoch 内严格递增且 JSON 往返稳定。
// 不变量：event 有 epoch/seq，没有 request_id，不能被误当成 command response。
#[test]
fn event_fixtures_cover_v1_contract_and_delivery_identity() {
    let (json, envelopes) = decode_fixtures(EVENT_FIXTURES);
    let mut kinds = BTreeSet::new();
    let mut connection_epoch = None;
    let mut previous_seq = None;

    for envelope in &envelopes {
        assert_eq!(envelope.protocol_version, DESKTOP_PROTOCOL_VERSION);
        let epoch = envelope
            .connection_epoch
            .expect("event fixture should have connection_epoch");
        if let Some(current) = connection_epoch {
            assert_eq!(epoch, current);
        } else {
            connection_epoch = Some(epoch);
        }
        assert_eq!(envelope.request_id, None);
        let seq = envelope.seq.expect("event fixture should have seq");
        if let Some(previous) = previous_seq {
            assert!(seq > previous);
        }
        previous_seq = Some(seq);

        let DesktopMessage::Event { event } = &envelope.payload else {
            panic!("event fixture should contain an event payload");
        };
        kinds.insert(event_kind(event));
    }

    assert_eq!(
        kinds,
        BTreeSet::from([
            "approval_requested",
            "assistant_finalized",
            "assistant_response_snapshot",
            "llm_call_ended",
            "llm_call_started",
            "resync_required",
            "state_changed",
            "stopped",
            "tool_call",
            "tool_result",
            "turn_completed",
            "turn_ended",
            "turn_failed",
            "turn_started",
        ])
    );
    assert_eq!(
        serde_json::to_value(&envelopes).expect("event fixtures should serialize"),
        json
    );
}
