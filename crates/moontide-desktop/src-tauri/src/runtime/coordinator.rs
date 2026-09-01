use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;
use tokio::time::timeout;

use crate::protocol as wire;

use super::{DesktopCommandError, DesktopRuntime, DesktopRuntimeEventStream, DesktopRuntimeHandle};

const GENERATION_DRAIN_TIMEOUT: Duration = Duration::from_secs(2);

type RuntimeFactory = dyn Fn() -> Result<DesktopRuntime> + Send + Sync;

pub(crate) struct DesktopRuntimeCoordinator {
    pub(crate) handle: DesktopRuntimeCoordinatorHandle,
    pub(crate) events: DesktopRuntimeEventStream,
}

#[derive(Clone)]
pub(crate) struct DesktopRuntimeCoordinatorHandle {
    inner: Arc<CoordinatorInner>,
}

struct CoordinatorInner {
    factory: Arc<RuntimeFactory>,
    current: Mutex<Option<RuntimeGeneration>>,
    event_sender: mpsc::Sender<wire::DesktopMessageEnvelope>,
}

struct RuntimeGeneration {
    handle: DesktopRuntimeHandle,
    forwarder: JoinHandle<Result<()>>,
}

impl DesktopRuntimeCoordinator {
    pub(crate) fn start<F>(factory: F, event_capacity: usize) -> Result<Self>
    where
        F: Fn() -> Result<DesktopRuntime> + Send + Sync + 'static,
    {
        let factory: Arc<RuntimeFactory> = Arc::new(factory);
        let (event_sender, event_receiver) = mpsc::channel(event_capacity);
        Ok(Self {
            handle: DesktopRuntimeCoordinatorHandle {
                inner: Arc::new(CoordinatorInner {
                    factory,
                    current: Mutex::new(None),
                    event_sender,
                }),
            },
            events: DesktopRuntimeEventStream {
                receiver: event_receiver,
            },
        })
    }
}

impl DesktopRuntimeCoordinatorHandle {
    pub(crate) async fn bootstrap_first_generation(&self) -> Result<(), DesktopCommandError> {
        let mut current = self.inner.current.lock().await;
        if current.is_some() {
            return Ok(());
        }
        let generation =
            start_generation(self.inner.factory.as_ref(), self.inner.event_sender.clone())
                .map_err(|error| DesktopCommandError::GenerationNotReady(error.to_string()))?;
        *current = Some(generation);
        Ok(())
    }

    pub(crate) async fn list_sessions(&self) -> Result<wire::DesktopResponse, DesktopCommandError> {
        let current = self.inner.current.lock().await;
        let generation = current.as_ref().ok_or_else(runtime_unavailable_error)?;
        Ok(generation.handle.list_sessions())
    }

    pub(crate) async fn create_session(
        &self,
    ) -> Result<wire::DesktopResponse, DesktopCommandError> {
        let current = self.inner.current.lock().await;
        let generation = current.as_ref().ok_or_else(runtime_unavailable_error)?;
        generation.handle.create_session().await
    }

    pub(crate) async fn start_session(
        &self,
        session_id: String,
    ) -> Result<wire::DesktopResponse, DesktopCommandError> {
        let current = self.inner.current.lock().await;
        let generation = current.as_ref().ok_or_else(runtime_unavailable_error)?;
        generation.handle.load_session(session_id).await
    }

    pub(crate) async fn new_chat(&self) -> Result<wire::DesktopResponse, DesktopCommandError> {
        let mut current = self.inner.current.lock().await;
        if let Some(generation) = current.take() {
            let shutdown = generation.handle.shutdown().await;
            match shutdown {
                Ok(wire::DesktopResponse::ShutdownCompleted { .. })
                | Err(DesktopCommandError::Stopped) => {}
                Ok(wire::DesktopResponse::Rejected { error }) => {
                    finish_generation(generation).await.ok();
                    return Ok(rejected(DesktopCommandError::ShutdownFailed(error.message)));
                }
                Ok(response) => {
                    finish_generation(generation).await.ok();
                    return Ok(rejected(DesktopCommandError::ShutdownFailed(format!(
                        "unexpected shutdown response: {response:?}"
                    ))));
                }
                Err(error) => {
                    finish_generation(generation).await.ok();
                    return Ok(rejected(DesktopCommandError::ShutdownFailed(
                        error.to_string(),
                    )));
                }
            }
            if let Err(error) = finish_generation(generation).await {
                return Ok(rejected(DesktopCommandError::GenerationNotReady(
                    error.to_string(),
                )));
            }
        }

        let generation =
            match start_generation(self.inner.factory.as_ref(), self.inner.event_sender.clone()) {
                Ok(generation) => generation,
                Err(error) => {
                    return Ok(rejected(DesktopCommandError::GenerationNotReady(
                        error.to_string(),
                    )));
                }
            };
        let connection_epoch = generation.handle.connection_epoch();
        *current = Some(generation);
        Ok(wire::DesktopResponse::GenerationReady { connection_epoch })
    }

    pub(crate) async fn submit_turn(
        &self,
        session_id: String,
        text: String,
    ) -> Result<wire::DesktopResponse, DesktopCommandError> {
        let current = self.inner.current.lock().await;
        let generation = current.as_ref().ok_or_else(runtime_unavailable_error)?;
        generation.handle.submit_turn(session_id, text).await
    }

    pub(crate) async fn cancel_turn(&self) -> Result<wire::DesktopResponse, DesktopCommandError> {
        let current = self.inner.current.lock().await;
        let generation = current.as_ref().ok_or_else(runtime_unavailable_error)?;
        generation.handle.cancel_turn().await
    }

    pub(crate) async fn approve(
        &self,
        approval_id: String,
    ) -> Result<wire::DesktopResponse, DesktopCommandError> {
        let current = self.inner.current.lock().await;
        let generation = current.as_ref().ok_or_else(runtime_unavailable_error)?;
        generation.handle.approve(approval_id).await
    }

    pub(crate) async fn deny(
        &self,
        approval_id: String,
        reason: String,
    ) -> Result<wire::DesktopResponse, DesktopCommandError> {
        let current = self.inner.current.lock().await;
        let generation = current.as_ref().ok_or_else(runtime_unavailable_error)?;
        generation.handle.deny(approval_id, reason).await
    }

    pub(crate) async fn snapshot(&self) -> Result<wire::DesktopResponse, DesktopCommandError> {
        let current = self.inner.current.lock().await;
        let generation = current.as_ref().ok_or_else(runtime_unavailable_error)?;
        generation.handle.snapshot().await
    }

    pub(crate) async fn shutdown(&self) -> Result<wire::DesktopResponse, DesktopCommandError> {
        let mut current = self.inner.current.lock().await;
        let Some(generation) = current.take() else {
            return Ok(wire::DesktopResponse::ShutdownCompleted {
                report: wire::ShutdownReportDto {
                    cancelled_turn: None,
                    progress_flushed: true,
                    diagnostic_log_flushed: true,
                },
            });
        };
        let response = generation.handle.shutdown().await;
        let drain = finish_generation(generation).await;
        match (response, drain) {
            (Ok(response), Ok(())) => Ok(response),
            (Err(error), _) => Err(error),
            (_, Err(error)) => Err(DesktopCommandError::Internal(error.to_string())),
        }
    }
}

fn start_generation(
    factory: &RuntimeFactory,
    event_sender: mpsc::Sender<wire::DesktopMessageEnvelope>,
) -> Result<RuntimeGeneration> {
    let DesktopRuntime { handle, events } = factory()?;
    let forwarder = tokio::spawn(forward_events(events, event_sender));
    Ok(RuntimeGeneration { handle, forwarder })
}

async fn forward_events(
    mut events: DesktopRuntimeEventStream,
    sender: mpsc::Sender<wire::DesktopMessageEnvelope>,
) -> Result<()> {
    while let Some(envelope) = events.recv().await {
        sender
            .send(envelope)
            .await
            .context("Desktop coordinator event receiver is closed")?;
    }
    Ok(())
}

async fn finish_generation(generation: RuntimeGeneration) -> Result<()> {
    let RuntimeGeneration {
        handle,
        mut forwarder,
    } = generation;
    drop(handle);
    match timeout(GENERATION_DRAIN_TIMEOUT, &mut forwarder).await {
        Ok(result) => result.context("Desktop generation event forwarder task failed")?,
        Err(_) => {
            forwarder.abort();
            let _ = forwarder.await;
            anyhow::bail!(
                "Desktop generation event forwarder did not drain within {GENERATION_DRAIN_TIMEOUT:?}"
            );
        }
    }
}

fn rejected(error: DesktopCommandError) -> wire::DesktopResponse {
    wire::DesktopResponse::Rejected {
        error: super::adapter::command_error_to_wire(&error),
    }
}

fn runtime_unavailable_error() -> DesktopCommandError {
    DesktopCommandError::GenerationNotReady("no current runtime".into())
}

#[cfg(test)]
mod tests {
    use std::path::Path;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use agent_core::{llm::protocol::ThinkingLevel, r#loop::ToolPermissionMap};
    use tempfile::TempDir;

    use super::*;

    fn config(root: &Path) -> agent::AgentConfig {
        agent::AgentConfig {
            cwd: root.to_path_buf(),
            sessions_dir: root.join("sessions"),
            runs_dir: root.join("runs"),
            provider: agent::resolve_provider_config(
                agent::ProviderId::Deepseek,
                agent::ProviderOverrides {
                    base_url: Some("https://example.com/v1"),
                    model: None,
                    api_key: Some("test-key"),
                },
            ),
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

    fn runtime(root: &Path) -> Result<DesktopRuntime> {
        DesktopRuntime::start(config(root), 16)
    }

    async fn bootstrapped_coordinator(root_path: std::path::PathBuf) -> DesktopRuntimeCoordinator {
        let coordinator =
            DesktopRuntimeCoordinator::start(move || runtime(&root_path), 16).expect("coordinator");
        coordinator
            .handle
            .bootstrap_first_generation()
            .await
            .expect("bootstrap first generation");
        coordinator
    }

    // 场景：Loaded Session 依次执行 New Chat 和加载原 Session。
    // 预期：旧 Agent 安全关闭，Blank 使用新 epoch，随后 Existing Session 恢复同一身份。
    // 不变量：切换只替换内存运行环境，不删除或复制原 Session Item Log。
    #[tokio::test]
    async fn loaded_blank_loaded_uses_a_fresh_runtime_epoch() {
        let root = TempDir::new().expect("tempdir");
        let root_path = root.path().to_path_buf();
        let coordinator = bootstrapped_coordinator(root_path).await;
        let handle = coordinator.handle;

        let first = handle.create_session().await.expect("start new Session");
        let (first_epoch, session_id) = match first {
            wire::DesktopResponse::SessionReady {
                connection_epoch,
                snapshot,
            } => (connection_epoch, snapshot.session.summary.session_id),
            response => panic!("unexpected start response: {response:?}"),
        };

        let ready = handle.new_chat().await.expect("new chat");
        let second_epoch = match ready {
            wire::DesktopResponse::GenerationReady { connection_epoch } => connection_epoch,
            response => panic!("unexpected new chat response: {response:?}"),
        };
        assert!(second_epoch > first_epoch);

        let blank_catalog = handle.list_sessions().await.expect("blank catalog");
        let wire::DesktopResponse::SessionCatalogListed { rows, .. } = blank_catalog else {
            panic!("expected catalog response")
        };
        assert_eq!(rows.len(), 1);
        assert!(!rows[0].loaded);

        let loaded = handle
            .start_session(session_id.clone())
            .await
            .expect("load existing Session");
        let wire::DesktopResponse::SessionReady { snapshot, .. } = loaded else {
            panic!("expected SessionReady")
        };
        assert_eq!(snapshot.session.summary.session_id, session_id);
    }

    // 场景：历史 Session 加载请求没有有效 identity。
    // 预期：start_session 返回 invalid_input，随后 create_session 仍可消费同一 Ready generation。
    // 不变量：输入校验先于 one-shot AgentConfig 消费，加载命令永远不能退化为新建命令。
    #[tokio::test]
    async fn invalid_existing_identity_does_not_consume_session_creation() {
        let root = TempDir::new().expect("tempdir");
        let root_path = root.path().to_path_buf();
        let coordinator = bootstrapped_coordinator(root_path).await;
        let handle = coordinator.handle;

        let invalid = handle
            .start_session("  ".into())
            .await
            .expect("typed load response");
        let wire::DesktopResponse::Rejected { error } = invalid else {
            panic!("expected rejected load")
        };
        assert_eq!(error.code, wire::DesktopCommandErrorCode::InvalidInput);

        let created = handle
            .create_session()
            .await
            .expect("create after invalid load");
        assert!(matches!(
            created,
            wire::DesktopResponse::SessionReady { .. }
        ));
    }

    // 场景：前端提交携带的 Session ID 与当前已加载 Session 不同。
    // 预期：submit_turn 返回 session_mismatch，不把消息发送给 Agent。
    // 不变量：submit_turn 只校验目标身份，不负责隐式加载或切换 Session。
    #[tokio::test]
    async fn submit_turn_rejects_a_session_other_than_the_loaded_session() {
        let root = TempDir::new().expect("tempdir");
        let root_path = root.path().to_path_buf();
        let coordinator = bootstrapped_coordinator(root_path).await;
        let handle = coordinator.handle;
        let ready = handle.create_session().await.expect("start Session");
        let wire::DesktopResponse::SessionReady { snapshot, .. } = ready else {
            panic!("expected SessionReady")
        };
        let loaded_session_id = snapshot.session.summary.session_id;

        let response = handle
            .submit_turn("another-session".into(), "must not be sent".into())
            .await
            .expect("typed submit response");

        let wire::DesktopResponse::Rejected { error } = response else {
            panic!("expected rejected submit")
        };
        assert_eq!(error.code, wire::DesktopCommandErrorCode::SessionMismatch);
        assert!(error.message.contains(&loaded_session_id));
        assert!(error.message.contains("another-session"));
    }

    // 场景：旧 Session 已停止后，fresh runtime factory 返回错误。
    // 预期：New Chat 返回 generation_not_ready，且后续 command 不会复用旧 runtime。
    // 不变量：初始化失败保持无 current runtime，不伪造 Ready 或 loaded Session。
    #[tokio::test]
    async fn fresh_runtime_failure_is_typed_after_clean_shutdown() {
        let root = TempDir::new().expect("tempdir");
        let root_path = root.path().to_path_buf();
        let starts = Arc::new(AtomicUsize::new(0));
        let factory_starts = Arc::clone(&starts);
        let coordinator = DesktopRuntimeCoordinator::start(
            move || {
                if factory_starts.fetch_add(1, Ordering::SeqCst) == 0 {
                    runtime(&root_path)
                } else {
                    anyhow::bail!("injected runtime construction failure")
                }
            },
            16,
        )
        .expect("initial coordinator");
        let handle = coordinator.handle;
        handle
            .bootstrap_first_generation()
            .await
            .expect("bootstrap first generation");
        handle.create_session().await.expect("start new Session");

        let response = handle.new_chat().await.expect("typed transition response");
        let wire::DesktopResponse::Rejected { error } = response else {
            panic!("expected rejected transition")
        };
        assert_eq!(
            error.code,
            wire::DesktopCommandErrorCode::GenerationNotReady
        );
        assert!(matches!(
            handle.list_sessions().await,
            Err(DesktopCommandError::GenerationNotReady(_))
        ));
    }

    // 场景：Session catalog storage path 是文件而不是目录。
    // 预期：list_sessions 返回 catalog_unavailable domain rejection。
    // 不变量：catalog 读取失败不创建 Agent，也不静默返回 empty。
    #[tokio::test]
    async fn catalog_storage_failure_is_not_reported_as_empty() {
        let root = TempDir::new().expect("tempdir");
        let sessions_path = root.path().join("sessions-file");
        std::fs::write(&sessions_path, b"not a directory").expect("sessions fixture");
        let root_path = root.path().to_path_buf();
        let sessions_for_factory = sessions_path.clone();
        let coordinator = DesktopRuntimeCoordinator::start(
            move || {
                let mut agent_config = config(&root_path);
                agent_config.sessions_dir = sessions_for_factory.clone();
                DesktopRuntime::start(agent_config, 16)
            },
            16,
        )
        .expect("coordinator");
        coordinator
            .handle
            .bootstrap_first_generation()
            .await
            .expect("bootstrap first generation");

        let response = coordinator
            .handle
            .list_sessions()
            .await
            .expect("typed catalog response");
        let wire::DesktopResponse::Rejected { error } = response else {
            panic!("expected rejected catalog")
        };
        assert_eq!(
            error.code,
            wire::DesktopCommandErrorCode::CatalogUnavailable
        );
    }
}
