use std::time::Duration;

use agent_core::{
    llm::{adapter::AdapterFamily, protocol::ThinkingLevel},
    r#loop::{ToolPermission, ToolPermissionMap},
};
use desktop_protocol as wire;
use tempfile::TempDir;
use tokio::time::timeout;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;

fn agent_config(root: &TempDir, base_url: String) -> agent::AgentConfig {
    agent::AgentConfig {
        cwd: root.path().to_path_buf(),
        sessions_dir: root.path().join("sessions"),
        runs_dir: root.path().join("runs"),
        provider: agent::ProviderConfig {
            family: AdapterFamily::OpenAiChatCompletions,
            base_url,
            api_key: "test-key".into(),
        },
        model: "test-model".into(),
        max_tokens: 128,
        thinking_level: Some(ThinkingLevel::Off),
        max_steps: 4,
        tool_names: Vec::new(),
        permissions: ToolPermissionMap::new(),
        approval: None,
        progress: None,
        persistence: agent::PersistenceConfig::default(),
    }
}

fn command(
    request_id: &str,
    connection_epoch: Option<wire::ConnectionEpoch>,
    command: wire::DesktopCommand,
) -> wire::DesktopMessageEnvelope {
    wire::DesktopMessageEnvelope {
        protocol_version: wire::DESKTOP_PROTOCOL_VERSION,
        connection_epoch,
        request_id: Some(wire::RequestId(request_id.into())),
        seq: None,
        payload: wire::DesktopMessage::Command { command },
    }
}

async fn handshake(handle: &DesktopProtocolServerHandle) -> wire::ConnectionEpoch {
    let response = handle
        .request(command("handshake", None, wire::DesktopCommand::Handshake))
        .await
        .expect("handshake response");
    assert_eq!(
        response.request_id,
        Some(wire::RequestId("handshake".into()))
    );
    assert_eq!(response.seq, None);
    let epoch = response
        .connection_epoch
        .expect("accepted handshake must establish an epoch");
    assert!(matches!(
        response.payload,
        wire::DesktopMessage::Response {
            response: wire::DesktopResponse::HandshakeAccepted {
                protocol_version: wire::DESKTOP_PROTOCOL_VERSION
            }
        }
    ));
    epoch
}

async fn start_new(handle: &DesktopProtocolServerHandle, epoch: wire::ConnectionEpoch) -> String {
    let response = handle
        .request(command(
            "start",
            Some(epoch),
            wire::DesktopCommand::StartSession {
                selection: wire::SessionSelectionDto::New,
            },
        ))
        .await
        .expect("start response");
    assert_eq!(response.request_id, Some(wire::RequestId("start".into())));
    assert_eq!(response.connection_epoch, Some(epoch));
    match response.payload {
        wire::DesktopMessage::Response {
            response: wire::DesktopResponse::SessionReady { snapshot },
        } => {
            assert_eq!(snapshot.state, wire::DesktopRunStateDto::Idle);
            snapshot.session.summary.session_id
        }
        other => panic!("expected SessionReady, got {other:?}"),
    }
}

fn rejected_code(envelope: wire::DesktopMessageEnvelope) -> wire::DesktopCommandErrorCode {
    match envelope.payload {
        wire::DesktopMessage::Response {
            response: wire::DesktopResponse::Rejected { error },
        } => error.code,
        other => panic!("expected rejected response, got {other:?}"),
    }
}

fn assert_response_identity(
    envelope: &wire::DesktopMessageEnvelope,
    request_id: &str,
    connection_epoch: wire::ConnectionEpoch,
) {
    assert_eq!(
        envelope.request_id,
        Some(wire::RequestId(request_id.into()))
    );
    assert_eq!(envelope.connection_epoch, Some(connection_epoch));
    assert_eq!(envelope.seq, None);
}

async fn shutdown_after_stopped(
    handle: &DesktopProtocolServerHandle,
    events: &mut DesktopProtocolEventStream,
    epoch: wire::ConnectionEpoch,
) -> wire::DesktopMessageEnvelope {
    let response = timeout(Duration::from_secs(10), async {
        let request = handle.request(command(
            "shutdown",
            Some(epoch),
            wire::DesktopCommand::Shutdown,
        ));
        tokio::pin!(request);
        let mut saw_stopped = false;
        loop {
            tokio::select! {
                biased;
                event = events.recv() => {
                    let Some(event) = event else {
                        assert!(saw_stopped, "event stream closed before Stopped");
                        return request.await.expect("shutdown response");
                    };
                    assert_eq!(event.connection_epoch, Some(epoch));
                    assert_eq!(event.request_id, None);
                    assert!(event.seq.is_some());
                    if matches!(
                        event.payload,
                        wire::DesktopMessage::Event {
                            event: wire::DesktopProtocolEvent::Stopped { .. }
                        }
                    ) {
                        saw_stopped = true;
                    }
                }
                response = &mut request => {
                    assert!(saw_stopped, "Stopped must be enqueued before shutdown response");
                    return response.expect("shutdown response");
                }
            }
        }
    })
    .await
    .expect("shutdown flow must complete");
    assert_response_identity(&response, "shutdown", epoch);
    response
}

async fn wait_for_approval(
    events: &mut DesktopProtocolEventStream,
    epoch: wire::ConnectionEpoch,
) -> String {
    timeout(Duration::from_secs(10), async {
        let mut last_seq = 0;
        loop {
            let event = events.recv().await.expect("approval event stream");
            assert_eq!(event.connection_epoch, Some(epoch));
            assert_eq!(event.request_id, None);
            let seq = event.seq.expect("event seq").0;
            assert!(seq > last_seq);
            last_seq = seq;
            if let wire::DesktopMessage::Event {
                event: wire::DesktopProtocolEvent::ApprovalRequested { request },
            } = event.payload
            {
                return request.id;
            }
        }
    })
    .await
    .expect("approval request must become observable")
}

// 场景：composition root 在 Tokio runtime 之外启动 protocol server。
// 预期：启动返回可传播错误，不触发 task-spawn panic 或创建 Agent。
// 不变量：runtime requirement 在公开 boundary 同步校验。
#[test]
fn protocol_server_requires_tokio_runtime() {
    let root = TempDir::new().expect("tempdir");
    let error = DesktopProtocolServer::start(DesktopProtocolConfig {
        agent: agent_config(&root, "https://example.com/v1".into()),
        event_capacity: 16,
    })
    .err()
    .expect("server start outside Tokio must fail");

    assert!(error.to_string().contains("Tokio runtime"));
}

// 场景：protocol output 与 Host EventBuffer 使用低于安全下限的 capacity。
// 预期：server 在分配 epoch 或启动 actor 前拒绝配置。
// 不变量：adapter 不削弱 D1 EventBuffer 的最小容量约束。
#[tokio::test]
async fn protocol_server_rejects_small_event_capacity() {
    let root = TempDir::new().expect("tempdir");
    let error = DesktopProtocolServer::start(DesktopProtocolConfig {
        agent: agent_config(&root, "https://example.com/v1".into()),
        event_capacity: 15,
    })
    .err()
    .expect("small event capacity must fail");

    assert!(error.to_string().contains("at least 16"));
}

// 场景：R1 command fixture 中的 handshake 进入一个尚未启动 Session 的 server。
// 预期：handshake 建立 epoch，之前/之后的 Session command 分别返回 typed lifecycle rejection。
// 不变量：request correlation 与 connection identity 在 Agent 创建前已经生效。
#[tokio::test]
async fn handshake_fixture_establishes_epoch_before_session_commands() {
    let root = TempDir::new().expect("tempdir");
    let (handle, _events) = DesktopProtocolServer::start(DesktopProtocolConfig {
        agent: agent_config(&root, "https://example.com/v1".into()),
        event_capacity: 16,
    })
    .expect("server should start");

    let before_handshake = handle
        .request(command(
            "before-handshake",
            Some(wire::ConnectionEpoch(999)),
            wire::DesktopCommand::Snapshot,
        ))
        .await
        .expect("typed rejection");
    assert_eq!(before_handshake.connection_epoch, None);
    assert_eq!(
        rejected_code(before_handshake),
        wire::DesktopCommandErrorCode::HandshakeRequired
    );

    let fixtures: Vec<wire::DesktopMessageEnvelope> = serde_json::from_str(include_str!(
        "../../../desktop-protocol/tests/fixtures/commands.json"
    ))
    .expect("command fixtures");
    let handshake_fixture = fixtures
        .into_iter()
        .find(|envelope| {
            matches!(
                &envelope.payload,
                wire::DesktopMessage::Command {
                    command: wire::DesktopCommand::Handshake
                }
            )
        })
        .expect("handshake fixture");
    let response = handle
        .request(handshake_fixture)
        .await
        .expect("fixture handshake response");
    let epoch = response.connection_epoch.expect("handshake epoch");

    let before_start = handle
        .request(command(
            "before-start",
            Some(epoch),
            wire::DesktopCommand::Snapshot,
        ))
        .await
        .expect("typed rejection");
    assert_eq!(before_start.connection_epoch, Some(epoch));
    assert_eq!(
        rejected_code(before_start),
        wire::DesktopCommandErrorCode::SessionNotStarted
    );
}

// 场景：一个合法 envelope 使用未知协议版本，随后同一 server 重新发送 v1 handshake。
// 预期：未知版本得到 correlated typed rejection，v1 handshake 仍可建立连接。
// 不变量：version rejection 不进入 Host，也不消耗 one-shot AgentConfig。
#[tokio::test]
async fn unsupported_version_does_not_consume_boot_config() {
    let root = TempDir::new().expect("tempdir");
    let (handle, _events) = DesktopProtocolServer::start(DesktopProtocolConfig {
        agent: agent_config(&root, "https://example.com/v1".into()),
        event_capacity: 16,
    })
    .expect("server should start");
    let mut unsupported = command("unsupported", None, wire::DesktopCommand::Handshake);
    unsupported.protocol_version = wire::ProtocolVersion(99);

    let response = handle
        .request(unsupported)
        .await
        .expect("version rejection");
    assert_eq!(
        response.request_id,
        Some(wire::RequestId("unsupported".into()))
    );
    assert_eq!(response.connection_epoch, None);
    assert_eq!(
        rejected_code(response),
        wire::DesktopCommandErrorCode::ProtocolVersionUnsupported
    );
    assert!(handshake(&handle).await.0 > 0);
}

// 场景：command envelope 伪造 event seq，无法满足 v1 framing identity。
// 预期：request 返回 infrastructure error，server 和 event stream 随后关闭。
// 不变量：结构错误不会被包装为已执行的 domain response。
#[tokio::test]
async fn invalid_command_identity_closes_the_protocol_server() {
    let root = TempDir::new().expect("tempdir");
    let (handle, mut events) = DesktopProtocolServer::start(DesktopProtocolConfig {
        agent: agent_config(&root, "https://example.com/v1".into()),
        event_capacity: 16,
    })
    .expect("server should start");
    let mut invalid = command("invalid", None, wire::DesktopCommand::Handshake);
    invalid.seq = Some(wire::Seq(1));

    let error = handle
        .request(invalid)
        .await
        .expect_err("invalid identity must fail");
    assert!(error.to_string().contains("must not contain seq"));
    assert_eq!(events.recv().await, None);
    assert!(handle
        .request(command("later", None, wire::DesktopCommand::Handshake))
        .await
        .is_err());
}

// 场景：v1 command boundary 收到缺失/空 request ID、错误 payload kind 或冲突 epoch。
// 预期：每种结构错误都在 domain routing 前被拒绝。
// 不变量：只有 Handshake 可省略 epoch，且只有 command payload 可进入 server actor。
#[test]
fn command_validation_rejects_all_structural_identity_conflicts() {
    let mut missing_request = command("missing", None, wire::DesktopCommand::Handshake);
    missing_request.request_id = None;
    assert!(validate_command_envelope(missing_request).is_err());

    let empty_request = command("  ", None, wire::DesktopCommand::Handshake);
    assert!(validate_command_envelope(empty_request).is_err());

    let mut wrong_payload = command("response", None, wire::DesktopCommand::Handshake);
    wrong_payload.payload = wire::DesktopMessage::Response {
        response: wire::DesktopResponse::HandshakeAccepted {
            protocol_version: wire::DESKTOP_PROTOCOL_VERSION,
        },
    };
    assert!(validate_command_envelope(wrong_payload).is_err());

    let handshake_with_epoch = command(
        "handshake-epoch",
        Some(wire::ConnectionEpoch(1)),
        wire::DesktopCommand::Handshake,
    );
    assert!(validate_command_envelope(handshake_with_epoch).is_err());

    let snapshot_without_epoch = command("snapshot", None, wire::DesktopCommand::Snapshot);
    assert!(validate_command_envelope(snapshot_without_epoch).is_err());
}

// 场景：event receiver 不再推进，导致 shutdown 时 forwarder 无法自然 drain。
// 预期：有界等待到期后 abort forwarder 并返回 infrastructure error。
// 不变量：Shutdown request 不会因 event backpressure 永久挂起或伪造成功 response。
#[tokio::test]
async fn blocked_event_forwarder_has_bounded_shutdown_wait() {
    let forwarder = tokio::spawn(async {
        std::future::pending::<()>().await;
        Ok(())
    });

    let error = finish_event_forwarder(forwarder, Duration::from_millis(10))
        .await
        .expect_err("blocked forwarder must time out");
    assert!(error.to_string().contains("did not drain"));
}

// 场景：Running server 的 protocol event receiver 异常消失，随后收到新 command。
// 预期：request 返回 connection/infrastructure error，server 不生成 Rejected success envelope。
// 不变量：abnormal stream closure 与可匹配的 Host domain rejection 保持不同失败边界。
#[tokio::test]
async fn unexpected_event_stream_closure_fails_the_connection() {
    let root = TempDir::new().expect("tempdir");
    let (handle, events) = DesktopProtocolServer::start(DesktopProtocolConfig {
        agent: agent_config(&root, "https://example.com/v1".into()),
        event_capacity: 16,
    })
    .expect("server should start");
    let epoch = handshake(&handle).await;
    let _ = start_new(&handle, epoch).await;
    drop(events);
    let submitted = handle
        .request(command(
            "trigger-event",
            Some(epoch),
            wire::DesktopCommand::SubmitTurn {
                text: "trigger event forwarding".into(),
            },
        ))
        .await
        .expect("Host accepts the command before observing receiver closure");
    assert!(matches!(
        submitted.payload,
        wire::DesktopMessage::Response {
            response: wire::DesktopResponse::TurnAccepted { .. }
        }
    ));
    tokio::time::sleep(Duration::from_millis(10)).await;

    let error = handle
        .request(command(
            "after-close",
            Some(epoch),
            wire::DesktopCommand::Snapshot,
        ))
        .await
        .expect_err("event stream failure must become observable");
    assert!(error.to_string().contains("event stream closed"));
}

// 场景：new Session 完成 snapshot、shutdown 后，再由新 server resume 同一 Session。
// 预期：Session identity 保持稳定，event 只携带 epoch/seq，Stopped 先于 shutdown response。
// 不变量：每个 server 只启动一个 Host，Session Item Log 仍由 Agent resume path 读取。
#[tokio::test]
async fn new_and_existing_session_boot_share_the_host_lifecycle() {
    let root = TempDir::new().expect("tempdir");
    let (handle, mut events) = DesktopProtocolServer::start(DesktopProtocolConfig {
        agent: agent_config(&root, "https://example.com/v1".into()),
        event_capacity: 16,
    })
    .expect("server should start");
    let epoch = handshake(&handle).await;
    let session_id = start_new(&handle, epoch).await;

    let first_event = events.recv().await.expect("initial Host event");
    assert_eq!(first_event.connection_epoch, Some(epoch));
    assert_eq!(first_event.request_id, None);
    assert_eq!(first_event.seq, Some(wire::Seq(1)));
    assert!(matches!(
        first_event.payload,
        wire::DesktopMessage::Event {
            event: wire::DesktopProtocolEvent::StateChanged {
                state: wire::DesktopRunStateDto::Idle
            }
        }
    ));

    let shutdown = shutdown_after_stopped(&handle, &mut events, epoch).await;
    assert!(matches!(
        shutdown.payload,
        wire::DesktopMessage::Response {
            response: wire::DesktopResponse::ShutdownCompleted { .. }
        }
    ));
    assert_eq!(events.recv().await, None);

    let (resumed_handle, mut resumed_events) =
        DesktopProtocolServer::start(DesktopProtocolConfig {
            agent: agent_config(&root, "https://example.com/v1".into()),
            event_capacity: 16,
        })
        .expect("resume server should start");
    let resumed_epoch = handshake(&resumed_handle).await;
    let response = resumed_handle
        .request(command(
            "resume",
            Some(resumed_epoch),
            wire::DesktopCommand::StartSession {
                selection: wire::SessionSelectionDto::Existing {
                    session_id: session_id.clone(),
                },
            },
        ))
        .await
        .expect("resume response");
    assert_response_identity(&response, "resume", resumed_epoch);
    assert!(matches!(
        response.payload,
        wire::DesktopMessage::Response {
            response: wire::DesktopResponse::SessionReady { snapshot }
        } if snapshot.session.summary.session_id == session_id
    ));
    let _ = shutdown_after_stopped(&resumed_handle, &mut resumed_events, resumed_epoch).await;
}

// 场景：Running server 收到重复 start、空 submit、无 active turn cancel 和未知 approval。
// 预期：每条 command 都返回相同 request ID 的稳定 typed rejection，Snapshot 仍可读取。
// 不变量：错误 command 不改变 Session ownership 或 wire envelope shape。
#[tokio::test]
async fn running_server_routes_typed_domain_rejections_and_snapshot() {
    let root = TempDir::new().expect("tempdir");
    let (handle, mut events) = DesktopProtocolServer::start(DesktopProtocolConfig {
        agent: agent_config(&root, "https://example.com/v1".into()),
        event_capacity: 16,
    })
    .expect("server should start");
    let epoch = handshake(&handle).await;
    let _ = start_new(&handle, epoch).await;

    let repeated_handshake = handle
        .request(command(
            "handshake-again",
            None,
            wire::DesktopCommand::Handshake,
        ))
        .await
        .expect("idempotent handshake response");
    assert_response_identity(&repeated_handshake, "handshake-again", epoch);
    assert_eq!(repeated_handshake.connection_epoch, Some(epoch));
    assert!(matches!(
        repeated_handshake.payload,
        wire::DesktopMessage::Response {
            response: wire::DesktopResponse::HandshakeAccepted { .. }
        }
    ));

    let cases = [
        (
            "repeat-start",
            wire::DesktopCommand::StartSession {
                selection: wire::SessionSelectionDto::New,
            },
            wire::DesktopCommandErrorCode::SessionAlreadyStarted,
        ),
        (
            "empty",
            wire::DesktopCommand::SubmitTurn { text: "  ".into() },
            wire::DesktopCommandErrorCode::InvalidInput,
        ),
        (
            "cancel",
            wire::DesktopCommand::CancelTurn,
            wire::DesktopCommandErrorCode::NoActiveTurn,
        ),
        (
            "approve",
            wire::DesktopCommand::Approve {
                approval_id: "missing".into(),
            },
            wire::DesktopCommandErrorCode::ApprovalNotFound,
        ),
        (
            "deny",
            wire::DesktopCommand::Deny {
                approval_id: "missing".into(),
                reason: "no".into(),
            },
            wire::DesktopCommandErrorCode::ApprovalNotFound,
        ),
    ];
    for (request_id, request, expected) in cases {
        let response = handle
            .request(command(request_id, Some(epoch), request))
            .await
            .expect("domain response");
        assert_eq!(
            response.request_id,
            Some(wire::RequestId(request_id.into()))
        );
        assert_eq!(rejected_code(response), expected);
    }

    let snapshot = handle
        .request(command(
            "snapshot",
            Some(epoch),
            wire::DesktopCommand::Snapshot,
        ))
        .await
        .expect("snapshot response");
    assert_response_identity(&snapshot, "snapshot", epoch);
    assert!(matches!(
        snapshot.payload,
        wire::DesktopMessage::Response {
            response: wire::DesktopResponse::Snapshot { .. }
        }
    ));
    let _ = shutdown_after_stopped(&handle, &mut events, epoch).await;
}

// 场景：provider request 保持 pending 时连续 submit，然后 cancel active Turn。
// 预期：第一条 TurnAccepted，第二条 Busy，cancel 原子返回同一 turn identity。
// 不变量：adapter 不通过 snapshot 猜测 cancellation response 的 turn。
#[tokio::test]
async fn submit_busy_and_cancel_preserve_active_turn_identity() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/chat/completions"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_delay(Duration::from_secs(30))
                .insert_header("content-type", "text/event-stream")
                .set_body_string("data: [DONE]\n\n"),
        )
        .mount(&server)
        .await;
    let root = TempDir::new().expect("tempdir");
    let (handle, mut events) = DesktopProtocolServer::start(DesktopProtocolConfig {
        agent: agent_config(&root, server.uri()),
        event_capacity: 32,
    })
    .expect("server should start");
    let epoch = handshake(&handle).await;
    let _ = start_new(&handle, epoch).await;

    let accepted = handle
        .request(command(
            "submit-1",
            Some(epoch),
            wire::DesktopCommand::SubmitTurn {
                text: "first".into(),
            },
        ))
        .await
        .expect("turn response");
    assert_response_identity(&accepted, "submit-1", epoch);
    assert!(matches!(
        accepted.payload,
        wire::DesktopMessage::Response {
            response: wire::DesktopResponse::TurnAccepted { turn: 0 }
        }
    ));

    let busy = handle
        .request(command(
            "submit-2",
            Some(epoch),
            wire::DesktopCommand::SubmitTurn {
                text: "second".into(),
            },
        ))
        .await
        .expect("busy response");
    assert_response_identity(&busy, "submit-2", epoch);
    assert_eq!(rejected_code(busy), wire::DesktopCommandErrorCode::Busy);

    let cancelled = handle
        .request(command(
            "cancel",
            Some(epoch),
            wire::DesktopCommand::CancelTurn,
        ))
        .await
        .expect("cancel response");
    assert_response_identity(&cancelled, "cancel", epoch);
    assert!(matches!(
        cancelled.payload,
        wire::DesktopMessage::Response {
            response: wire::DesktopResponse::CancellationAccepted { turn: 0 }
        }
    ));
    let _ = shutdown_after_stopped(&handle, &mut events, epoch).await;
}

// 场景：真实 provider tool-call 分别进入 Approve 与 Deny protocol command。
// 预期：两种 decision 都以 ApprovalAccepted 确认，且使用 event 中的 approval identity。
// 不变量：wire adapter 不拥有 approval truth，只把 decision 路由给唯一 Host broker。
#[tokio::test]
async fn approve_and_deny_route_pending_host_approval() {
    const TOOL_CALL_SSE: &str = "\
data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call-1\",\"function\":{\"name\":\"read\",\"arguments\":\"{\\\"path\\\":\\\"Cargo.toml\\\",\\\"limit\\\":1}\"}}]},\"finish_reason\":null}]}\n\
\n\
data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"tool_calls\"}]}\n\
\n\
data: [DONE]\n\
";
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/chat/completions"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "text/event-stream")
                .set_body_string(TOOL_CALL_SSE),
        )
        .mount(&server)
        .await;
    let root = TempDir::new().expect("tempdir");

    for approve in [true, false] {
        let mut config = agent_config(&root, server.uri());
        config.tool_names = vec!["read".into()];
        config
            .permissions
            .insert("read".into(), ToolPermission::Ask);
        let (handle, mut events) = DesktopProtocolServer::start(DesktopProtocolConfig {
            agent: config,
            event_capacity: 32,
        })
        .expect("server should start");
        let epoch = handshake(&handle).await;
        let _ = start_new(&handle, epoch).await;
        let submitted = handle
            .request(command(
                "submit",
                Some(epoch),
                wire::DesktopCommand::SubmitTurn {
                    text: "read one line".into(),
                },
            ))
            .await
            .expect("submit response");
        assert_response_identity(&submitted, "submit", epoch);
        assert!(matches!(
            submitted.payload,
            wire::DesktopMessage::Response {
                response: wire::DesktopResponse::TurnAccepted { turn: 0 }
            }
        ));
        let approval_id = wait_for_approval(&mut events, epoch).await;
        let decision = if approve {
            wire::DesktopCommand::Approve {
                approval_id: approval_id.clone(),
            }
        } else {
            wire::DesktopCommand::Deny {
                approval_id: approval_id.clone(),
                reason: "not allowed in this test".into(),
            }
        };
        let response = handle
            .request(command("decision", Some(epoch), decision))
            .await
            .expect("approval decision response");
        assert_response_identity(&response, "decision", epoch);
        assert!(matches!(
            response.payload,
            wire::DesktopMessage::Response {
                response: wire::DesktopResponse::ApprovalAccepted {
                    approval_id: accepted
                }
            } if accepted == approval_id
        ));
        let _ = shutdown_after_stopped(&handle, &mut events, epoch).await;
    }
}

// 场景：one-shot boot config 在首次 StartSession 时校验失败。
// 预期：失败被关联为 Internal rejection，server 随后关闭且不能重试创建另一个 Agent。
// 不变量：失败启动不会留下可复用的隐式 config factory 或第二个 Host owner。
#[tokio::test]
async fn failed_session_boot_closes_the_one_shot_server() {
    let root = TempDir::new().expect("tempdir");
    let mut config = agent_config(&root, "https://example.com/v1".into());
    config.model.clear();
    let (handle, mut events) = DesktopProtocolServer::start(DesktopProtocolConfig {
        agent: config,
        event_capacity: 16,
    })
    .expect("server actor should start before lazy Agent boot");
    let epoch = handshake(&handle).await;

    let response = handle
        .request(command(
            "start-invalid",
            Some(epoch),
            wire::DesktopCommand::StartSession {
                selection: wire::SessionSelectionDto::New,
            },
        ))
        .await
        .expect("correlated boot rejection");
    assert_eq!(
        response.request_id,
        Some(wire::RequestId("start-invalid".into()))
    );
    assert_eq!(
        rejected_code(response),
        wire::DesktopCommandErrorCode::Internal
    );
    assert_eq!(events.recv().await, None);
    assert!(handle
        .request(command(
            "retry",
            Some(epoch),
            wire::DesktopCommand::StartSession {
                selection: wire::SessionSelectionDto::New,
            },
        ))
        .await
        .is_err());
}
