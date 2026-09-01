use std::collections::BTreeSet;

use moontide_desktop_lib::protocol::{
    DesktopCommand, DesktopMessage, DesktopMessageEnvelope, DesktopProtocolEvent, DesktopResponse,
    DESKTOP_PROTOCOL_VERSION,
};
use serde_json::Value;

const EVENT_FIXTURES: &str = include_str!("protocol/fixtures/events.json");
const HISTORY_FIXTURE: &str = include_str!("protocol/fixtures/history.json");

fn decode_fixtures(source: &str) -> (Value, Vec<DesktopMessageEnvelope>) {
    let json: Value = serde_json::from_str(source).expect("fixture file should contain valid JSON");
    let envelopes = serde_json::from_value(json.clone())
        .expect("fixture JSON should conform to DesktopMessageEnvelope");
    (json, envelopes)
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

// 场景：Host event delivery 向 WebView 提供所有语义 event 的 JSON fixtures。
// 预期：fixtures 覆盖每个 event variant，seq 在同一 epoch 内严格递增且 JSON 往返稳定。
// 不变量：event 有 epoch/seq，没有 request_id，不能被误当成 typed invoke response。
#[test]
fn event_fixtures_cover_v1_contract_and_delivery_identity() {
    let (json, envelopes) = decode_fixtures(EVENT_FIXTURES);
    let mut kinds = BTreeSet::new();
    let mut connection_epoch = None;
    let mut previous_seq: Option<moontide_desktop_lib::protocol::Seq> = None;

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
            assert!(seq.0 > previous.0);
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

// 场景：Rust 与 TypeScript 共用一个历史分页 command/response JSON fixture。
// 预期：exclusive Turn cursor、Session identity、item payload 与终页标记均可解析。
// 不变量：两端协议 schema 不会对分页字段或 Rust enum tagging 产生漂移。
#[test]
fn history_fixture_conforms_to_rust_protocol() {
    let fixture: Value =
        serde_json::from_str(HISTORY_FIXTURE).expect("history fixture should be valid JSON");
    let command: DesktopCommand = serde_json::from_value(fixture["command"].clone())
        .expect("history command fixture should conform");
    let response: DesktopResponse = serde_json::from_value(fixture["response"].clone())
        .expect("history response fixture should conform");

    assert!(matches!(
        command,
        DesktopCommand::LoadSessionHistory {
            ref session_id,
            before_turn: 30,
            limit: 30,
        } if session_id == "session-1"
    ));
    assert!(matches!(
        response,
        DesktopResponse::SessionHistoryPage {
            ref session_id,
            oldest_turn: Some(0),
            has_older: false,
            ..
        } if session_id == "session-1"
    ));
}
