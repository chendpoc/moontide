use std::sync::Arc;
use std::time::Duration;

use anyhow::{
    Context,
    Result,
};
use tokio::sync::{
    Mutex,
    mpsc,
};
use tokio::task::JoinHandle;
use tokio::time::timeout;

use super::{
    DesktopCommandError,
    DesktopRuntime,
    DesktopRuntimeEventStream,
    DesktopRuntimeHandle,
};
use crate::protocol as wire;

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

    pub(crate) async fn load_session_history(
        &self,
        session_id: String,
        before_turn: u64,
        limit: u32,
    ) -> Result<wire::DesktopResponse, DesktopCommandError> {
        let (handle, requested_epoch) = {
            let current = self.inner.current.lock().await;
            let generation = current.as_ref().ok_or_else(runtime_unavailable_error)?;
            (
                generation.handle.clone(),
                generation.handle.connection_epoch(),
            )
        };
        let response = tokio::task::spawn_blocking(move || {
            handle.load_session_history(session_id, before_turn, limit)
        })
        .await
        .map_err(|error| {
            DesktopCommandError::Internal(format!("history read task failed: {error}"))
        })?;
        let current = self.inner.current.lock().await;
        let Some(generation) = current.as_ref() else {
            return Ok(rejected(DesktopCommandError::GenerationNotReady(
                "history request outlived its runtime generation".into(),
            )));
        };
        if generation.handle.connection_epoch() != requested_epoch {
            return Ok(rejected(DesktopCommandError::GenerationNotReady(
                "history request outlived its runtime generation".into(),
            )));
        }
        Ok(response)
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
    use std::sync::atomic::{
        AtomicUsize,
        Ordering,
    };

    use agent_core::llm::protocol::{
        ContentBlock,
        ThinkingLevel,
    };
    use agent_core::r#loop::ToolPermissionMap;
    use agent_core::session::{
        SessionItemDraft,
        SessionStore,
    };
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
                    protocol: None,
                    user_profile: None,
                    host_profile: None,
                },
            )
            .expect("resolve provider"),
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

    fn item_turn(item: &wire::SessionItemDto) -> u64 {
        match item {
            wire::SessionItemDto::UserMessage { base, .. }
            | wire::SessionItemDto::AssistantMessage { base, .. }
            | wire::SessionItemDto::ToolCall { base, .. }
            | wire::SessionItemDto::ToolResult { base, .. }
            | wire::SessionItemDto::Compaction { base, .. }
            | wire::SessionItemDto::CheckpointCreated { base, .. } => base.turn,
        }
    }

    fn session_log_path(root: &Path, session_id: &str) -> std::path::PathBuf {
        std::fs::read_dir(root.join("sessions"))
            .expect("sessions directory")
            .filter_map(std::result::Result::ok)
            .map(|entry| entry.path())
            .find(|path| path.join(format!("{session_id}.meta.json")).is_file())
            .expect("Session partition")
            .join(format!("{session_id}.log.jsonl"))
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

    // 场景：持久化 Session 有 65 个 Turn，Desktop 加载它并连续向前翻页。
    // 预期：初始快照只含最新 30 个完整 Turn，后续页面按 exclusive Turn cursor 返回。
    // 不变量：任何页面都不拆分 Turn，最终页明确标记不存在更早历史。
    #[tokio::test]
    async fn session_history_is_bounded_and_pages_backwards_by_complete_turn() {
        let root = TempDir::new().expect("tempdir");
        let sessions_dir = root.path().join("sessions");
        let mut store =
            SessionStore::create(&sessions_dir, root.path().to_path_buf()).expect("Session");
        for turn in 0..65 {
            store
                .commit_item(SessionItemDraft::UserMessage {
                    turn,
                    text: format!("user-{turn}"),
                })
                .expect("user item");
            store
                .commit_item(SessionItemDraft::AssistantMessage {
                    turn,
                    blocks: vec![ContentBlock::Text {
                        text: format!("assistant-{turn}"),
                    }],
                })
                .expect("assistant item");
        }
        let session_id = store.header().session_id.clone();
        drop(store);

        let coordinator = bootstrapped_coordinator(root.path().to_path_buf()).await;
        let ready = coordinator
            .handle
            .start_session(session_id.clone())
            .await
            .expect("load Session");
        let wire::DesktopResponse::SessionReady { snapshot, .. } = ready else {
            panic!("expected SessionReady")
        };
        assert_eq!(snapshot.session.items.len(), 60);
        assert_eq!(snapshot.session.history.oldest_turn, Some(35));
        assert!(snapshot.session.history.has_older);
        assert!(
            snapshot
                .session
                .items
                .iter()
                .all(|item| (35..65).contains(&item_turn(item)))
        );

        let middle = coordinator
            .handle
            .load_session_history(session_id.clone(), 35, 30)
            .await
            .expect("middle history page");
        let wire::DesktopResponse::SessionHistoryPage {
            items,
            oldest_turn,
            has_older,
            ..
        } = middle
        else {
            panic!("expected history page")
        };
        assert_eq!(items.len(), 60);
        assert_eq!(oldest_turn, Some(5));
        assert!(has_older);
        assert!(items.iter().all(|item| (5..35).contains(&item_turn(item))));

        let oldest = coordinator
            .handle
            .load_session_history(session_id, 5, 30)
            .await
            .expect("oldest history page");
        let wire::DesktopResponse::SessionHistoryPage {
            items,
            oldest_turn,
            has_older,
            ..
        } = oldest
        else {
            panic!("expected history page")
        };
        assert_eq!(items.len(), 10);
        assert_eq!(oldest_turn, Some(0));
        assert!(!has_older);
        assert!(items.iter().all(|item| item_turn(item) < 5));
    }

    // 场景：加载历史时请求不同 Session identity，或给出越界 limit。
    // 预期：runtime 返回 typed rejection，且不读取或替换当前 Session 状态。
    // 不变量：分页 API 只能读取当前已加载 Session，limit 始终处于 1..=100。
    #[tokio::test]
    async fn session_history_rejects_identity_mismatch_and_invalid_limits() {
        let root = TempDir::new().expect("tempdir");
        let coordinator = bootstrapped_coordinator(root.path().to_path_buf()).await;
        let ready = coordinator
            .handle
            .create_session()
            .await
            .expect("create Session");
        let wire::DesktopResponse::SessionReady { snapshot, .. } = ready else {
            panic!("expected SessionReady")
        };
        let session_id = snapshot.session.summary.session_id;

        let mismatch = coordinator
            .handle
            .load_session_history("another-session".into(), 1, 30)
            .await
            .expect("typed mismatch");
        let wire::DesktopResponse::Rejected { error } = mismatch else {
            panic!("expected mismatch rejection")
        };
        assert_eq!(error.code, wire::DesktopCommandErrorCode::SessionMismatch);

        for limit in [0, 101] {
            let invalid = coordinator
                .handle
                .load_session_history(session_id.clone(), 1, limit)
                .await
                .expect("typed invalid limit");
            let wire::DesktopResponse::Rejected { error } = invalid else {
                panic!("expected invalid-input rejection")
            };
            assert_eq!(error.code, wire::DesktopCommandErrorCode::InvalidInput);
        }
    }

    // 场景：当前 Loaded Session 的持久化 JSONL 在后续历史读取前损坏。
    // 预期：load_session_history 返回 history_unavailable，而 loaded identity 仍用于后续校验。
    // 不变量：历史读取失败不替换、关闭或伪造当前 Host-owned Session identity。
    #[tokio::test]
    async fn session_history_storage_failure_is_typed_without_clearing_loaded_identity() {
        let root = TempDir::new().expect("tempdir");
        let coordinator = bootstrapped_coordinator(root.path().to_path_buf()).await;
        let ready = coordinator
            .handle
            .create_session()
            .await
            .expect("create Session");
        let wire::DesktopResponse::SessionReady { snapshot, .. } = ready else {
            panic!("expected SessionReady")
        };
        let session_id = snapshot.session.summary.session_id;
        std::fs::write(
            session_log_path(root.path(), &session_id),
            b"{invalid-json\n",
        )
        .expect("corrupt test Session log");

        let response = coordinator
            .handle
            .load_session_history(session_id.clone(), 1, 30)
            .await
            .expect("typed history failure");
        let wire::DesktopResponse::Rejected { error } = response else {
            panic!("expected history rejection")
        };
        assert_eq!(
            error.code,
            wire::DesktopCommandErrorCode::HistoryUnavailable
        );

        let mismatch = coordinator
            .handle
            .load_session_history("another-session".into(), 1, 30)
            .await
            .expect("loaded identity remains authoritative");
        let wire::DesktopResponse::Rejected { error } = mismatch else {
            panic!("expected Session mismatch")
        };
        assert_eq!(error.code, wire::DesktopCommandErrorCode::SessionMismatch);
        assert!(error.message.contains(&session_id));
    }
}
