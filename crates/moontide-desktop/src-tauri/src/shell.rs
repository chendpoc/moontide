use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use anyhow::{Context, Result};
use desktop_protocol as wire;
use serde::Serialize;
use tauri::{Emitter, Manager, State, WindowEvent};
use tokio::time::timeout;

use crate::bootstrap::DesktopRuntime;
use crate::protocol_client::{
    DesktopProtocolClient, DesktopProtocolClientEvent, DesktopProtocolClientEventStream,
};

const ENVELOPE_EVENT: &str = "desktop-envelope";
const CONNECTION_EVENT: &str = "desktop-connection";
const WINDOW_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(3);

struct AppState {
    client: DesktopProtocolClient,
    close_started: AtomicBool,
}

#[derive(Clone, Serialize)]
struct BridgeError {
    message: String,
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum ConnectionPayload {
    Disconnected { message: String },
    DegradedShutdown { message: String },
}

enum ShutdownOutcome {
    Clean,
    Degraded,
}

pub(crate) fn run(runtime: DesktopRuntime) -> Result<()> {
    let DesktopRuntime { client, events } = runtime;
    tauri::Builder::default()
        .setup(move |app| {
            spawn_event_pump(app.handle().clone(), events);
            app.manage(AppState {
                client,
                close_started: AtomicBool::new(false),
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            let WindowEvent::CloseRequested { api, .. } = event else {
                return;
            };
            api.prevent_close();
            let state = window.state::<AppState>();
            if state.close_started.swap(true, Ordering::AcqRel) {
                return;
            }

            let client = state.client.clone();
            let window = window.clone();
            tauri::async_runtime::spawn(async move {
                if matches!(request_shutdown(&client).await, ShutdownOutcome::Degraded) {
                    let _ = window.emit(
                        CONNECTION_EVENT,
                        ConnectionPayload::DegradedShutdown {
                            message: "MoonTide could not confirm graceful runtime shutdown".into(),
                        },
                    );
                    eprintln!("MoonTide Desktop shutdown degraded");
                }
                if window.destroy().is_err() {
                    eprintln!("MoonTide Desktop window destruction failed");
                }
            });
        })
        .invoke_handler(tauri::generate_handler![desktop_request])
        .run(tauri::generate_context!())
        .context("run MoonTide Desktop Tauri shell")
}

fn spawn_event_pump(app: tauri::AppHandle, mut events: DesktopProtocolClientEventStream) {
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            match event {
                DesktopProtocolClientEvent::Envelope(envelope) => {
                    if app.emit(ENVELOPE_EVENT, envelope).is_err() {
                        break;
                    }
                }
                DesktopProtocolClientEvent::Disconnected { graceful: true, .. } => break,
                DesktopProtocolClientEvent::Disconnected {
                    graceful: false,
                    reason,
                } => {
                    let _ = app.emit(
                        CONNECTION_EVENT,
                        ConnectionPayload::Disconnected { message: reason },
                    );
                    break;
                }
            }
        }
    });
}

#[tauri::command]
async fn desktop_request(
    state: State<'_, AppState>,
    command: wire::DesktopCommand,
) -> std::result::Result<wire::DesktopMessageEnvelope, BridgeError> {
    state
        .client
        .request(command)
        .await
        .map_err(|error| BridgeError {
            message: error.to_string(),
        })
}

async fn request_shutdown(client: &DesktopProtocolClient) -> ShutdownOutcome {
    let response = timeout(
        WINDOW_SHUTDOWN_TIMEOUT,
        client.request(wire::DesktopCommand::Shutdown),
    )
    .await;
    match response {
        Ok(Ok(wire::DesktopMessageEnvelope {
            payload:
                wire::DesktopMessage::Response {
                    response: wire::DesktopResponse::ShutdownCompleted { .. },
                },
            ..
        })) => ShutdownOutcome::Clean,
        Ok(Ok(_)) | Ok(Err(_)) | Err(_) => ShutdownOutcome::Degraded,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transport::transport_pair;

    // 场景：Svelte 产品入口、Tauri permission 和安全配置完成 R5 收敛。
    // 预期：只允许 receive-only events 与 desktop_request，禁用 global API/CSP 空值和动态 HTML。
    // 不变量：Web intent 无法绕过 protocol client，也无法取得 process/filesystem/shell authority。
    #[test]
    fn frontend_and_capability_enforce_the_security_baseline() {
        let permission = include_str!("../permissions/allow-desktop-request.toml");
        let capability = include_str!("../capabilities/default.json");
        let config = include_str!("../tauri.conf.json");
        let bridge = include_str!("../../frontend/src/tauriBridge.ts");
        let app = include_str!("../../frontend/src/App.svelte");
        let frontend = [
            include_str!("../../frontend/index.html"),
            include_str!("../../frontend/src/main.ts"),
            app,
            bridge,
        ]
        .join("\n");

        assert!(permission.contains("desktop_request"));
        assert!(!capability.contains("core:default"));
        assert!(!capability.contains("allow-emit"));
        assert!(!capability.contains("core:window"));
        assert!(capability.contains("core:event:allow-listen"));
        assert!(capability.contains("core:event:allow-unlisten"));
        for forbidden_capability in ["shell:", "fs:", "process:"] {
            assert!(!capability.contains(forbidden_capability));
        }
        assert!(config.contains("\"withGlobalTauri\": false"));
        assert!(!config.contains("\"csp\": null"));
        assert!(config.contains("\"capabilities\": [\"default\"]"));
        assert!(config.contains("\"frontendDist\": \"../frontend/dist\""));
        assert!(config.contains("\"icon\": [\"icons/icon.png\"]"));
        assert!(bridge.contains("@tauri-apps/api/core"));
        assert!(bridge.contains("@tauri-apps/api/event"));
        assert!(bridge.contains("desktop_request"));
        assert_eq!(bridge.matches("invoke<unknown>").count(), 1);
        for forbidden_component_owner in [
            "@tauri-apps",
            "DesktopMessageEnvelope",
            "parseDesktopMessageEnvelope",
            "reduceEnvelope",
        ] {
            assert!(!app.contains(forbidden_component_owner));
        }
        for unsafe_frontend_pattern in ["window.__TAURI__", "innerHTML", "{@html"] {
            assert!(!frontend.contains(unsafe_frontend_pattern));
        }
        for legacy_handler in [
            "fetch_snapshot",
            "submit_turn",
            "cancel_turn",
            "approve",
            "deny",
        ] {
            assert!(!permission.contains(legacy_handler));
        }
        for legacy_invoke in [
            "invoke(\"fetch_snapshot\"",
            "invoke(\"submit_turn\"",
            "invoke(\"cancel_turn\"",
            "invoke(\"approve\"",
            "invoke(\"deny\"",
        ] {
            assert!(!frontend.contains(legacy_invoke));
        }
    }

    // 场景：window close coordinator 分别收到完整 ShutdownCompleted 与未握手 client。
    // 预期：前者分类为 clean，后者分类为 degraded，调用方随后都可 destroy window。
    // 不变量：窗口关闭不把 transport/domain failure 伪装成已确认的 graceful shutdown。
    #[tokio::test]
    async fn close_coordinator_distinguishes_clean_and_degraded_shutdown() {
        let (transport, mut peer) = transport_pair(8).expect("transport pair");
        let (client, _events) = DesktopProtocolClient::start(transport, 8).expect("client");
        let handshake = {
            let client = client.clone();
            tokio::spawn(async move { client.request(wire::DesktopCommand::Handshake).await })
        };
        let handshake_request = peer.receiver.recv().await.expect("handshake request");
        let epoch = wire::ConnectionEpoch(5);
        peer.sender
            .send(Ok(wire::DesktopMessageEnvelope {
                protocol_version: wire::DESKTOP_PROTOCOL_VERSION,
                connection_epoch: Some(epoch),
                request_id: handshake_request.request_id,
                seq: None,
                payload: wire::DesktopMessage::Response {
                    response: wire::DesktopResponse::HandshakeAccepted {
                        protocol_version: wire::DESKTOP_PROTOCOL_VERSION,
                    },
                },
            }))
            .await
            .expect("handshake response");
        handshake.await.expect("handshake task").expect("handshake");

        let shutdown = {
            let client = client.clone();
            tokio::spawn(async move { request_shutdown(&client).await })
        };
        let shutdown_request = peer.receiver.recv().await.expect("shutdown request");
        peer.sender
            .send(Ok(wire::DesktopMessageEnvelope {
                protocol_version: wire::DESKTOP_PROTOCOL_VERSION,
                connection_epoch: Some(epoch),
                request_id: shutdown_request.request_id,
                seq: None,
                payload: wire::DesktopMessage::Response {
                    response: wire::DesktopResponse::ShutdownCompleted {
                        report: wire::ShutdownReportDto {
                            cancelled_turn: None,
                            progress_flushed: true,
                            diagnostic_log_flushed: true,
                        },
                    },
                },
            }))
            .await
            .expect("shutdown response");
        assert!(matches!(
            shutdown.await.expect("shutdown task"),
            ShutdownOutcome::Clean
        ));

        let (unhandshaken_transport, _) = transport_pair(2).expect("transport pair");
        let (unhandshaken, _events) =
            DesktopProtocolClient::start(unhandshaken_transport, 2).expect("client");
        assert!(matches!(
            request_shutdown(&unhandshaken).await,
            ShutdownOutcome::Degraded
        ));
    }
}
