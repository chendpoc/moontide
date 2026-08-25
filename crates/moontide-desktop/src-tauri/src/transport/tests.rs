use std::time::Duration;

use agent::{
    AdapterFamily, AgentConfig, PersistenceConfig, ProviderConfig, SessionPersistence,
    ToolPermissionMap,
};
use desktop::{DesktopProtocolConfig, DesktopProtocolServer};
use tempfile::TempDir;
use tokio::time::timeout;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;
use crate::protocol_client::{
    DesktopProtocolClient, DesktopProtocolClientEvent, DesktopProtocolClientEventStream,
};

fn agent_config(root: &TempDir, base_url: String) -> AgentConfig {
    AgentConfig {
        cwd: root.path().to_path_buf(),
        sessions_dir: root.path().join("sessions"),
        runs_dir: root.path().join("runs"),
        provider: ProviderConfig {
            family: AdapterFamily::OpenAiChatCompletions,
            base_url,
            api_key: "test-key".into(),
        },
        model: "test-model".into(),
        max_tokens: 128,
        thinking_level: None,
        max_steps: 4,
        tool_names: Vec::new(),
        permissions: ToolPermissionMap::new(),
        approval: None,
        progress: None,
        persistence: PersistenceConfig {
            session: SessionPersistence::Items,
            diagnostic: agent::DiagnosticPersistence::Off,
        },
    }
}

fn wire_response(envelope: wire::DesktopMessageEnvelope) -> wire::DesktopResponse {
    match envelope.payload {
        wire::DesktopMessage::Response { response } => response,
        other => panic!("expected response, got {other:?}"),
    }
}

async fn receive_stopped_then_graceful_close(
    events: &mut DesktopProtocolClientEventStream,
) -> bool {
    timeout(Duration::from_secs(5), async {
        let mut stopped = false;
        loop {
            match events.recv().await {
                Some(DesktopProtocolClientEvent::Envelope(envelope)) => {
                    if matches!(
                        envelope.payload,
                        wire::DesktopMessage::Event {
                            event: wire::DesktopProtocolEvent::Stopped { .. }
                        }
                    ) {
                        stopped = true;
                    }
                }
                Some(DesktopProtocolClientEvent::Disconnected { graceful: true, .. }) => {
                    return stopped
                }
                Some(DesktopProtocolClientEvent::Disconnected {
                    graceful: false,
                    reason,
                }) => panic!("unexpected degraded close: {reason}"),
                None => return false,
            }
        }
    })
    .await
    .expect("client close must become observable")
}

// 场景：composition root 为 in-process transport 配置零容量 channel。
// 预期：构造立即返回可传播错误，不启动 server pump。
// 不变量：所有 Desktop transport queue 都是显式 bounded 且容量非零。
#[tokio::test]
async fn in_process_transport_rejects_zero_capacity() {
    let root = TempDir::new().expect("tempdir");
    let (server, events) = DesktopProtocolServer::start(DesktopProtocolConfig {
        agent: agent_config(&root, "https://example.com/v1".into()),
        event_capacity: 16,
    })
    .expect("server");

    assert!(connect_in_process(server, events, 0).is_err());
}

// 场景：真实 R2 server 通过 in-process transport 完成 boot、snapshot、submit、cancel、shutdown。
// 预期：client 只发送 intent，却收到完整 correlated response；Stopped 先于 graceful close。
// 不变量：Tauri/D3 path 不取得 Host handle，transport 不改变 envelope identity 或 domain result。
#[tokio::test]
async fn in_process_transport_runs_the_protocol_vertical_slice() {
    let provider = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/chat/completions"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_delay(Duration::from_secs(30))
                .insert_header("content-type", "text/event-stream")
                .set_body_string("data: [DONE]\n\n"),
        )
        .mount(&provider)
        .await;
    let root = TempDir::new().expect("tempdir");
    let (server, server_events) = DesktopProtocolServer::start(DesktopProtocolConfig {
        agent: agent_config(&root, provider.uri()),
        event_capacity: 32,
    })
    .expect("server");
    let transport = connect_in_process(server, server_events, 32).expect("transport");
    let (client, mut events) = DesktopProtocolClient::start(transport, 64).expect("client");

    let handshake = client
        .request(wire::DesktopCommand::Handshake)
        .await
        .expect("handshake");
    let epoch = handshake
        .connection_epoch
        .expect("handshake must establish epoch");
    assert!(matches!(
        wire_response(handshake),
        wire::DesktopResponse::HandshakeAccepted { .. }
    ));

    let started = client
        .request(wire::DesktopCommand::StartSession {
            selection: wire::SessionSelectionDto::New,
        })
        .await
        .expect("start session");
    assert_eq!(started.connection_epoch, Some(epoch));
    assert!(matches!(
        wire_response(started),
        wire::DesktopResponse::SessionReady { .. }
    ));

    let snapshot = client
        .request(wire::DesktopCommand::Snapshot)
        .await
        .expect("snapshot");
    assert!(matches!(
        wire_response(snapshot),
        wire::DesktopResponse::Snapshot { .. }
    ));

    let submitted = client
        .request(wire::DesktopCommand::SubmitTurn {
            text: "hold the turn".into(),
        })
        .await
        .expect("submit");
    assert!(matches!(
        wire_response(submitted),
        wire::DesktopResponse::TurnAccepted { turn: 0 }
    ));
    let cancelled = client
        .request(wire::DesktopCommand::CancelTurn)
        .await
        .expect("cancel");
    assert!(matches!(
        wire_response(cancelled),
        wire::DesktopResponse::CancellationAccepted { turn: 0 }
    ));

    let shutdown = client
        .request(wire::DesktopCommand::Shutdown)
        .await
        .expect("shutdown");
    assert!(matches!(
        wire_response(shutdown),
        wire::DesktopResponse::ShutdownCompleted { .. }
    ));
    assert!(receive_stopped_then_graceful_close(&mut events).await);
}
