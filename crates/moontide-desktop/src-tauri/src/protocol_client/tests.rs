use tokio::time::{timeout, Duration};

use super::*;
use crate::transport::{transport_pair, TransportPeer};

fn response(
    request: &wire::DesktopMessageEnvelope,
    epoch: Option<wire::ConnectionEpoch>,
    response: wire::DesktopResponse,
) -> wire::DesktopMessageEnvelope {
    wire::DesktopMessageEnvelope {
        protocol_version: wire::DESKTOP_PROTOCOL_VERSION,
        connection_epoch: epoch,
        request_id: request.request_id.clone(),
        seq: None,
        payload: wire::DesktopMessage::Response { response },
    }
}

async fn complete_handshake(
    client: &DesktopProtocolClient,
    peer: &mut TransportPeer,
) -> wire::ConnectionEpoch {
    let request = {
        let client = client.clone();
        tokio::spawn(async move { client.request(wire::DesktopCommand::Handshake).await })
    };
    let envelope = peer.receiver.recv().await.expect("handshake envelope");
    let epoch = wire::ConnectionEpoch(7);
    peer.sender
        .send(Ok(response(
            &envelope,
            Some(epoch),
            wire::DesktopResponse::HandshakeAccepted {
                protocol_version: wire::DESKTOP_PROTOCOL_VERSION,
            },
        )))
        .await
        .expect("handshake response delivery");
    request
        .await
        .expect("handshake task")
        .expect("handshake response");
    epoch
}

// 场景：composition root 在 Tokio runtime 之外启动 protocol client。
// 预期：返回可传播错误，不因 spawn 缺少 runtime 而 panic。
// 不变量：client actor 的 runtime requirement 在同步构造边界校验。
#[test]
fn client_requires_tokio_runtime() {
    let (transport, _) = transport_pair(4).expect("transport pair");
    assert!(DesktopProtocolClient::start(transport, 4).is_err());
}

// 场景：Submit 与 Cancel intent 并发进入 client，fake transport 逆序返回不同 response kind。
// 预期：client 分配唯一 ID、注入 handshake epoch，并按 ID 将每种 response 送回原 caller。
// 不变量：caller 不构造 envelope identity，response 到达顺序不等于 request ownership。
#[tokio::test]
async fn request_ids_and_pending_responses_are_correlated() {
    let (transport, mut peer) = transport_pair(8).expect("transport pair");
    let (client, _events) = DesktopProtocolClient::start(transport, 8).expect("client");
    let epoch = complete_handshake(&client, &mut peer).await;

    let first = {
        let client = client.clone();
        tokio::spawn(async move {
            client
                .request(wire::DesktopCommand::SubmitTurn {
                    text: "hello".into(),
                })
                .await
        })
    };
    let second = {
        let client = client.clone();
        tokio::spawn(async move { client.request(wire::DesktopCommand::CancelTurn).await })
    };
    let first_outgoing = peer.receiver.recv().await.expect("first request");
    let second_outgoing = peer.receiver.recv().await.expect("second request");
    assert_ne!(first_outgoing.request_id, second_outgoing.request_id);
    for outgoing in [&first_outgoing, &second_outgoing] {
        assert_eq!(outgoing.connection_epoch, Some(epoch));
        assert_eq!(outgoing.seq, None);
    }

    let response_for = |outgoing: &wire::DesktopMessageEnvelope| match &outgoing.payload {
        wire::DesktopMessage::Command {
            command: wire::DesktopCommand::SubmitTurn { .. },
        } => wire::DesktopResponse::TurnAccepted { turn: 3 },
        wire::DesktopMessage::Command {
            command: wire::DesktopCommand::CancelTurn,
        } => wire::DesktopResponse::CancellationAccepted { turn: 3 },
        other => panic!("unexpected outgoing payload: {other:?}"),
    };
    for outgoing in [&second_outgoing, &first_outgoing] {
        peer.sender
            .send(Ok(response(outgoing, Some(epoch), response_for(outgoing))))
            .await
            .expect("response delivery");
    }
    let request_id_for = |kind: &str| {
        [&first_outgoing, &second_outgoing]
            .into_iter()
            .find_map(|outgoing| {
                let matches_kind = matches!(
                    (&outgoing.payload, kind),
                    (
                        wire::DesktopMessage::Command {
                            command: wire::DesktopCommand::SubmitTurn { .. }
                        },
                        "submit"
                    ) | (
                        wire::DesktopMessage::Command {
                            command: wire::DesktopCommand::CancelTurn
                        },
                        "cancel"
                    )
                );
                matches_kind.then(|| outgoing.request_id.clone())
            })
            .flatten()
            .expect("outgoing request identity")
    };

    let first_response = first.await.expect("first task").expect("first response");
    let second_response = second.await.expect("second task").expect("second response");
    assert_eq!(first_response.request_id, Some(request_id_for("submit")));
    assert_eq!(second_response.request_id, Some(request_id_for("cancel")));
    assert!(matches!(
        first_response.payload,
        wire::DesktopMessage::Response {
            response: wire::DesktopResponse::TurnAccepted { turn: 3 }
        }
    ));
    assert!(matches!(
        second_response.payload,
        wire::DesktopMessage::Response {
            response: wire::DesktopResponse::CancellationAccepted { turn: 3 }
        }
    ));
}

// 场景：transport 在一个 Snapshot request pending 时发送未知 request ID 的 response。
// 预期：pending request 失败且 event stream 收到非 graceful disconnect。
// 不变量：未知 response 不被忽略或错误关联到任一 caller。
#[tokio::test]
async fn unknown_response_fails_all_pending_requests() {
    let (transport, mut peer) = transport_pair(8).expect("transport pair");
    let (client, mut events) = DesktopProtocolClient::start(transport, 8).expect("client");
    let epoch = complete_handshake(&client, &mut peer).await;
    let pending = {
        let client = client.clone();
        tokio::spawn(async move { client.request(wire::DesktopCommand::Snapshot).await })
    };
    let _ = peer.receiver.recv().await.expect("snapshot request");
    peer.sender
        .send(Ok(wire::DesktopMessageEnvelope {
            protocol_version: wire::DESKTOP_PROTOCOL_VERSION,
            connection_epoch: Some(epoch),
            request_id: Some(wire::RequestId("unknown".into())),
            seq: None,
            payload: wire::DesktopMessage::Response {
                response: wire::DesktopResponse::Rejected {
                    error: wire::DesktopCommandErrorDto {
                        code: wire::DesktopCommandErrorCode::Internal,
                        message: "unexpected".into(),
                    },
                },
            },
        }))
        .await
        .expect("unknown response delivery");

    assert!(pending.await.expect("pending task").is_err());
    assert!(matches!(
        events.recv().await,
        Some(DesktopProtocolClientEvent::Disconnected {
            graceful: false,
            ..
        })
    ));
}

// 场景：transport 在一个 correlated request pending 时直接关闭 incoming side。
// 预期：client 结束 pending request、发布 disconnect，并拒绝后续 intent。
// 不变量：connection close 不留下永远等待的 oneshot 或隐式重连。
#[tokio::test]
async fn transport_close_cleans_up_pending_requests() {
    let (transport, mut peer) = transport_pair(8).expect("transport pair");
    let (client, mut events) = DesktopProtocolClient::start(transport, 8).expect("client");
    let _ = complete_handshake(&client, &mut peer).await;
    let pending = {
        let client = client.clone();
        tokio::spawn(async move { client.request(wire::DesktopCommand::Snapshot).await })
    };
    let _ = peer.receiver.recv().await.expect("snapshot request");
    drop(peer.sender);

    assert!(pending.await.expect("pending task").is_err());
    assert!(matches!(
        events.recv().await,
        Some(DesktopProtocolClientEvent::Disconnected {
            graceful: false,
            ..
        })
    ));
    assert!(client
        .request(wire::DesktopCommand::Snapshot)
        .await
        .is_err());
}

// 场景：fake transport 在 handshake 后发布一个合法 Host event envelope。
// 预期：client event stream 原样交付 epoch/seq/payload，不生成 request ID。
// 不变量：client 只校验 delivery identity，不重写 Host 分配的 event sequence。
#[tokio::test]
async fn event_subscription_preserves_delivery_identity() {
    let (transport, mut peer) = transport_pair(8).expect("transport pair");
    let (client, mut events) = DesktopProtocolClient::start(transport, 8).expect("client");
    let epoch = complete_handshake(&client, &mut peer).await;
    peer.sender
        .send(Ok(wire::DesktopMessageEnvelope {
            protocol_version: wire::DESKTOP_PROTOCOL_VERSION,
            connection_epoch: Some(epoch),
            request_id: None,
            seq: Some(wire::Seq(11)),
            payload: wire::DesktopMessage::Event {
                event: wire::DesktopProtocolEvent::StateChanged {
                    state: wire::DesktopRunStateDto::Idle,
                },
            },
        }))
        .await
        .expect("event delivery");

    let event = timeout(Duration::from_secs(1), events.recv())
        .await
        .expect("event timeout")
        .expect("client event");
    let DesktopProtocolClientEvent::Envelope(envelope) = event else {
        panic!("expected protocol envelope");
    };
    assert_eq!(envelope.connection_epoch, Some(epoch));
    assert_eq!(envelope.request_id, None);
    assert_eq!(envelope.seq, Some(wire::Seq(11)));
}

// 场景：client event buffer 容量为一，transport 连续交付两个合法 event。
// 预期：先交付已缓冲 event，再交付独立 connection-disconnected 状态。
// 不变量：event backpressure 不会挤掉唯一的 degraded connection evidence。
#[tokio::test]
async fn event_overflow_preserves_disconnect_evidence() {
    let (transport, mut peer) = transport_pair(8).expect("transport pair");
    let (client, mut events) = DesktopProtocolClient::start(transport, 1).expect("client");
    let epoch = complete_handshake(&client, &mut peer).await;
    for seq in [1, 2] {
        peer.sender
            .send(Ok(wire::DesktopMessageEnvelope {
                protocol_version: wire::DESKTOP_PROTOCOL_VERSION,
                connection_epoch: Some(epoch),
                request_id: None,
                seq: Some(wire::Seq(seq)),
                payload: wire::DesktopMessage::Event {
                    event: wire::DesktopProtocolEvent::StateChanged {
                        state: wire::DesktopRunStateDto::Idle,
                    },
                },
            }))
            .await
            .expect("event delivery");
    }
    tokio::time::sleep(Duration::from_millis(10)).await;

    assert!(matches!(
        events.recv().await,
        Some(DesktopProtocolClientEvent::Envelope(_))
    ));
    assert!(matches!(
        events.recv().await,
        Some(DesktopProtocolClientEvent::Disconnected {
            graceful: false,
            ..
        })
    ));
}

// 场景：caller 在 Handshake response 之前发送 Session command。
// 预期：client 本地拒绝 intent，transport 不接收伪造的 epoch-less command。
// 不变量：Web caller 无法绕过 client boot gate 构造 connection identity。
#[tokio::test]
async fn session_command_requires_completed_handshake() {
    let (transport, mut peer) = transport_pair(4).expect("transport pair");
    let (client, _events) = DesktopProtocolClient::start(transport, 4).expect("client");

    assert!(client
        .request(wire::DesktopCommand::Snapshot)
        .await
        .is_err());
    assert!(peer.receiver.try_recv().is_err());
}

// 场景：transport 持续取走 command 但不返回 response，调用数超过 client pending 上限。
// 预期：只发送上限数量的 envelope，额外调用立即失败且不会分配 transport work。
// 不变量：未来 process transport 也不能通过持续 drain 让 pending map 无界增长。
#[tokio::test]
async fn pending_requests_have_an_explicit_bound() {
    let (transport, mut peer) = transport_pair(MAX_PENDING_REQUESTS + 2).expect("transport pair");
    let (client, _events) = DesktopProtocolClient::start(transport, 8).expect("client");
    complete_handshake(&client, &mut peer).await;
    let TransportPeer {
        mut receiver,
        sender,
    } = peer;

    let mut requests = Vec::new();
    for _ in 0..=MAX_PENDING_REQUESTS {
        let client = client.clone();
        requests.push(tokio::spawn(async move {
            client.request(wire::DesktopCommand::Snapshot).await
        }));
    }

    tokio::time::timeout(std::time::Duration::from_secs(1), async {
        loop {
            if requests.iter().any(tokio::task::JoinHandle::is_finished) {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("pending limit response");

    drop(sender);
    let mut sent = 0;
    while receiver.recv().await.is_some() {
        sent += 1;
    }
    assert_eq!(sent, MAX_PENDING_REQUESTS);

    let mut limit_errors = 0;
    for request in requests {
        let error = request
            .await
            .expect("request task")
            .expect_err("all requests end after transport close");
        if error
            .to_string()
            .contains("pending request limit was reached")
        {
            limit_errors += 1;
        }
    }
    assert_eq!(limit_errors, 1);
}
