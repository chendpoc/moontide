use agent_core::{llm::protocol::ThinkingLevel, r#loop::ToolPermissionMap};
use tempfile::TempDir;

use super::*;
use crate::runtime::DesktopCommandError;

fn config(root: &TempDir) -> agent::AgentConfig {
    agent::AgentConfig {
        cwd: root.path().to_path_buf(),
        sessions_dir: root.path().join("sessions"),
        runs_dir: root.path().join("runs"),
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

// 场景：Host 启动后查询完整 session snapshot 并关闭。
// 预期：create path 不创建第二 writer，shutdown 完成 flush 并关闭 event stream。
#[tokio::test]
async fn host_start_snapshot_and_shutdown() {
    let root = TempDir::new().expect("tempdir");
    let (handle, mut stream) = DesktopHost::start(DesktopConfig {
        agent: config(&root),
        session: SessionSelection::New,
        event_capacity: 16,
    })
    .await
    .expect("host should start");

    let snapshot = handle.snapshot().await.expect("snapshot should load");
    assert_eq!(snapshot.session.summary.item_count, 0);
    let report = handle.shutdown().await.expect("shutdown should complete");
    assert!(report.progress_flushed);
    assert!(report.diagnostic_log_flushed);
    while stream.recv().await.is_some() {}
}

// 场景：同一 Host 在第一个 Turn active 时再次提交文本。
// 预期：第二次提交返回 typed Busy，不依赖错误字符串；不变量：同一 Session 只有一个 active Turn。
#[tokio::test]
async fn host_rejects_second_active_turn_with_typed_busy() {
    let root = TempDir::new().expect("tempdir");
    let agent = agent::Agent::create(config(&root)).expect("agent should start");
    let session_id = agent.session_id().to_owned();
    let buffer = EventBuffer::new(16);
    let shared_state = Arc::new(Mutex::new(DesktopRunState::Idle));
    let broker = Arc::new(ApprovalBroker::new(
        root.path().to_path_buf(),
        session_id.clone(),
        Arc::clone(&shared_state),
        Arc::clone(&buffer),
    ));
    let query = agent::SessionQuery::new(root.path().join("sessions"));
    let (_sender, receiver) = mpsc::channel(1);
    let mut actor = HostActor {
        agent: Some(agent),
        session_id,
        query,
        broker,
        buffer,
        shared_state,
        receiver,
        state: DesktopRunState::Idle,
        next_turn: 0,
        active: None,
    };

    assert_eq!(actor.start_turn("first".into()), Ok(0));
    assert_eq!(
        actor.start_turn("second".into()),
        Err(DesktopCommandError::Busy)
    );
    let active = actor.active.take().expect("active turn");
    active.cancellation.cancel();
    let turn = active.turn;
    let cancellation = active.cancellation;
    let result = active.join.await.expect("turn task should return");
    actor.finish_turn(turn, cancellation, Ok(result)).await;
}
