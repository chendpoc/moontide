use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use anyhow::{Context, Result};
use serde::Serialize;
use tauri::{Emitter, Manager, State, WindowEvent};
use tokio::time::timeout;

use crate::protocol as wire;
use crate::runtime::{
    DesktopRuntimeCoordinator, DesktopRuntimeCoordinatorHandle, DesktopRuntimeEventStream,
};

const ENVELOPE_EVENT: &str = "desktop-envelope";
const CONNECTION_EVENT: &str = "desktop-connection";
const WINDOW_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(3);

struct AppState {
    runtime: DesktopRuntimeHandleState,
    close_started: AtomicBool,
}

#[derive(Clone)]
struct DesktopRuntimeHandleState {
    inner: DesktopRuntimeCoordinatorHandle,
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

pub(crate) fn run(runtime: DesktopRuntimeCoordinator) -> Result<()> {
    let DesktopRuntimeCoordinator { handle, events } = runtime;
    tauri::Builder::default()
        .setup(move |app| {
            let runtime_handle = handle.clone();
            tauri::async_runtime::block_on(async move {
                runtime_handle.bootstrap_first_generation().await
            })
            .map_err(|error| {
                anyhow::anyhow!("bootstrap MoonTide Desktop runtime generation: {error}")
            })?;
            spawn_event_pump(app.handle().clone(), events);
            app.manage(AppState {
                runtime: DesktopRuntimeHandleState { inner: handle },
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

            let runtime = state.runtime.clone();
            let window = window.clone();
            tauri::async_runtime::spawn(async move {
                if matches!(request_shutdown(&runtime).await, ShutdownOutcome::Degraded) {
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
        .invoke_handler(tauri::generate_handler![
            list_sessions,
            new_chat,
            create_session,
            start_session,
            submit_turn,
            cancel_turn,
            approve,
            deny,
            snapshot,
            shutdown,
        ])
        .run(tauri::generate_context!())
        .context("run MoonTide Desktop Tauri shell")
}

#[tauri::command]
async fn list_sessions(state: State<'_, AppState>) -> Result<wire::DesktopResponse, BridgeError> {
    state
        .runtime
        .inner
        .list_sessions()
        .await
        .map_err(bridge_error)
}

#[tauri::command]
async fn new_chat(state: State<'_, AppState>) -> Result<wire::DesktopResponse, BridgeError> {
    state.runtime.inner.new_chat().await.map_err(bridge_error)
}

fn spawn_event_pump(app: tauri::AppHandle, mut events: DesktopRuntimeEventStream) {
    tauri::async_runtime::spawn(async move {
        while let Some(envelope) = events.recv().await {
            if app.emit(ENVELOPE_EVENT, envelope).is_err() {
                break;
            }
        }
        let _ = app.emit(
            CONNECTION_EVENT,
            ConnectionPayload::Disconnected {
                message: "Desktop runtime event stream closed".into(),
            },
        );
    });
}

#[tauri::command]
async fn create_session(state: State<'_, AppState>) -> Result<wire::DesktopResponse, BridgeError> {
    state
        .runtime
        .inner
        .create_session()
        .await
        .map_err(bridge_error)
}

#[tauri::command]
async fn start_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<wire::DesktopResponse, BridgeError> {
    state
        .runtime
        .inner
        .start_session(session_id)
        .await
        .map_err(bridge_error)
}

#[tauri::command]
async fn submit_turn(
    state: State<'_, AppState>,
    session_id: String,
    text: String,
) -> Result<wire::DesktopResponse, BridgeError> {
    state
        .runtime
        .inner
        .submit_turn(session_id, text)
        .await
        .map_err(bridge_error)
}

#[tauri::command]
async fn cancel_turn(state: State<'_, AppState>) -> Result<wire::DesktopResponse, BridgeError> {
    state
        .runtime
        .inner
        .cancel_turn()
        .await
        .map_err(bridge_error)
}

#[tauri::command]
async fn approve(
    state: State<'_, AppState>,
    approval_id: String,
) -> Result<wire::DesktopResponse, BridgeError> {
    state
        .runtime
        .inner
        .approve(approval_id)
        .await
        .map_err(bridge_error)
}

#[tauri::command]
async fn deny(
    state: State<'_, AppState>,
    approval_id: String,
    reason: String,
) -> Result<wire::DesktopResponse, BridgeError> {
    state
        .runtime
        .inner
        .deny(approval_id, reason)
        .await
        .map_err(bridge_error)
}

#[tauri::command]
async fn snapshot(state: State<'_, AppState>) -> Result<wire::DesktopResponse, BridgeError> {
    state.runtime.inner.snapshot().await.map_err(bridge_error)
}

#[tauri::command]
async fn shutdown(state: State<'_, AppState>) -> Result<wire::DesktopResponse, BridgeError> {
    state.runtime.inner.shutdown().await.map_err(bridge_error)
}

fn bridge_error(error: crate::runtime::DesktopCommandError) -> BridgeError {
    BridgeError {
        message: error.to_string(),
    }
}

async fn request_shutdown(runtime: &DesktopRuntimeHandleState) -> ShutdownOutcome {
    let response = timeout(WINDOW_SHUTDOWN_TIMEOUT, runtime.inner.shutdown()).await;
    match response {
        Ok(Ok(wire::DesktopResponse::ShutdownCompleted { .. })) => ShutdownOutcome::Clean,
        Ok(Ok(_)) | Ok(Err(_)) | Err(_) => ShutdownOutcome::Degraded,
    }
}

#[cfg(test)]
mod tests {

    // 场景：Svelte 产品入口、Tauri permission 和安全配置完成 integrated runtime 收敛。
    // 预期：只允许 receive-only events 与 typed invoke commands，禁用 global API/CSP 空值和动态 HTML。
    // 不变量：Web intent 无法绕过 runtime handle，也无法取得 process/filesystem/shell authority。
    #[test]
    fn frontend_and_capability_enforce_the_security_baseline() {
        let capabilities_dir =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("capabilities");
        let permissions_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("permissions");
        let capability = std::fs::read_to_string(capabilities_dir.join("default.json"))
            .expect("default capability");
        let config = include_str!("../tauri.conf.json");
        let bridge = include_str!("../../frontend/src/lib/bridge/tauriBridge.ts");
        let app = include_str!("../../frontend/src/app/App.svelte");
        let frontend = [
            include_str!("../../frontend/index.html"),
            include_str!("../../frontend/src/main.ts"),
            app,
            bridge,
        ]
        .join("\n");

        for command in [
            "list_sessions",
            "new_chat",
            "create_session",
            "start_session",
            "submit_turn",
            "cancel_turn",
            "approve",
            "deny",
            "snapshot",
            "shutdown",
        ] {
            let permission = std::fs::read_to_string(
                permissions_dir.join(format!("allow-{}.toml", command.replace('_', "-"))),
            )
            .unwrap_or_else(|error| panic!("permission for {command}: {error}"));
            assert!(permission.contains(command));
        }
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
        for typed_invoke in [
            "list_sessions",
            "new_chat",
            "create_session",
            "start_session",
            "submit_turn",
            "cancel_turn",
            "approve",
            "deny",
            "snapshot",
            "shutdown",
        ] {
            assert!(bridge.contains(typed_invoke));
        }
        assert!(!bridge.contains("desktop_request"));
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
        for legacy_invoke in ["invoke(\"desktop_request\"", "invoke(\"fetch_snapshot\""] {
            assert!(!frontend.contains(legacy_invoke));
        }
    }
}
