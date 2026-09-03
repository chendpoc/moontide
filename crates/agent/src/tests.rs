use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use agent_core::llm::adapter_family::AdapterFamily;
use agent_core::llm::profile_config::ContinuityHint;
use agent_core::llm::protocol::ThinkingLevel;
use agent_core::r#loop::ToolPermission;
use tempfile::TempDir;

use crate::{
    prompt,
    resolve_provider_config,
    Agent,
    AgentConfig,
    ProviderId,
    ProviderOverrides,
};

fn config(temp: &TempDir) -> AgentConfig {
    AgentConfig {
        cwd: temp.path().to_path_buf(),
        sessions_dir: temp.path().join("sessions"),
        runs_dir: temp.path().join("runs"),
        provider: resolve_provider_config(
            ProviderId::Deepseek,
            ProviderOverrides {
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
        permissions: BTreeMap::new(),
        approval: None,
        progress: None,
        persistence: crate::PersistenceConfig::default(),
    }
}

// Scenario: a fully resolved minimal config is bootstrapped without network access.
// Expected: Agent creation succeeds and creates non-empty stable session identity.
// Invariant: provider construction is local; no API request is made during bootstrap.
#[tokio::test]
async fn create_builds_minimal_agent() {
    let temp = tempfile::tempdir().expect("tempdir should be available for test");
    let agent = Agent::create(config(&temp)).expect("minimal agent should bootstrap");

    assert!(!agent.session_id().is_empty());
    assert!(temp.path().join("sessions").is_dir());
    assert!(temp.path().join("runs").is_dir());
    assert!(fs::read_dir(temp.path().join("runs"))
        .expect("runs directory should be readable")
        .next()
        .is_none());
}

// Scenario: Agent creation is attempted without a Tokio runtime.
// Expected: bootstrap fails before constructing providers, sessions, or hooks.
// Invariant: the host cannot activate a synchronous Progress fallback.
#[test]
fn create_requires_tokio_runtime() {
    let temp = tempfile::tempdir().expect("tempdir should be available for test");
    let error = Agent::create(config(&temp))
        .err()
        .expect("agent creation outside a runtime must fail");
    assert!(error.to_string().contains("Tokio runtime"));
}

// Scenario: a created session is reopened through the composition root.
// Expected: resume returns the same Session identity.
// Invariant: loading does not create a second session log for the supplied id.
#[tokio::test]
async fn resume_preserves_session_identity() {
    let temp = tempfile::tempdir().expect("tempdir should be available for test");
    let created = Agent::create(config(&temp)).expect("minimal agent should bootstrap");
    let session_id = created.session_id().to_owned();
    drop(created);

    let resumed = Agent::resume(config(&temp), &session_id).expect("session should resume");
    assert_eq!(resumed.session_id(), session_id);
}

// Scenario: runtime settings change provider-facing limits without creating a new session.
// Expected: reload keeps session identity while apply_turn_limits updates per-turn bounds.
// Invariant: session item log remains tied to the original session id after reload.
#[tokio::test]
async fn reload_preserves_session_and_applies_turn_limits() {
    let temp = tempfile::tempdir().expect("tempdir should be available for test");
    let mut agent = Agent::create(config(&temp)).expect("minimal agent should bootstrap");
    let session_id = agent.session_id().to_owned();

    agent
        .apply_turn_limits(6, 256, Some(ThinkingLevel::Low))
        .expect("turn limits should apply");

    let mut updated = config(&temp);
    updated.provider.base_url = "https://updated.example/v1".into();
    agent.reload(updated).await.expect("agent should reload");
    assert_eq!(agent.session_id(), session_id);
}

// Scenario: reload keeps Responses continuity sidecar when protocol is unchanged.
// Expected: previous_response_id survives provider/base_url refresh on the same protocol.
// Invariant: continuity_hint is memory-only and is not reset by unrelated L2 changes.
#[tokio::test]
async fn reload_preserves_continuity_hint_when_protocol_unchanged() {
    let temp = tempfile::tempdir().expect("tempdir should be available for test");
    let mut agent = Agent::create(config(&temp)).expect("minimal agent should bootstrap");
    agent.set_continuity_hint_for_test(ContinuityHint {
        previous_response_id: Some("resp_keep".into()),
    });

    let mut updated = config(&temp);
    updated.provider.base_url = "https://updated.example/v1".into();
    agent.reload(updated).await.expect("agent should reload");

    assert_eq!(
        agent
            .continuity_hint_for_test()
            .previous_response_id
            .as_deref(),
        Some("resp_keep")
    );
}

// Scenario: reload switches DeepSeek from Responses to Chat Completions.
// Expected: continuity sidecar is cleared because optimized path is protocol-specific.
// Invariant: protocol change must not reuse a Responses response_id on another wire family.
#[tokio::test]
async fn reload_clears_continuity_hint_when_protocol_changes() {
    let temp = tempfile::tempdir().expect("tempdir should be available for test");
    let mut agent = Agent::create(config(&temp)).expect("minimal agent should bootstrap");
    agent.set_continuity_hint_for_test(ContinuityHint {
        previous_response_id: Some("resp_drop".into()),
    });

    let mut switched = config(&temp);
    switched.provider = resolve_provider_config(
        ProviderId::Deepseek,
        ProviderOverrides {
            base_url: Some("https://example.com/v1"),
            model: None,
            api_key: Some("test-key"),
            protocol: Some(AdapterFamily::OpenAiChatCompletions),
            user_profile: None,
            host_profile: None,
        },
    )
    .expect("resolve chat protocol");
    agent.reload(switched).await.expect("agent should reload");

    assert!(agent
        .continuity_hint_for_test()
        .previous_response_id
        .is_none());
}

// Scenario: config contains a tool name absent from the first-party catalog.
// Expected: bootstrap fails before constructing a runnable Agent.
// Invariant: unknown capabilities are rejected at composition time, not on first model call.
#[tokio::test]
async fn unknown_tool_is_rejected_during_bootstrap() {
    let temp = tempfile::tempdir().expect("tempdir should be available for test");
    let mut agent_config = config(&temp);
    agent_config.tool_names = vec!["does_not_exist".into()];
    agent_config
        .permissions
        .insert("does_not_exist".into(), ToolPermission::Allow);

    let error = Agent::create(agent_config)
        .err()
        .expect("unknown tool must fail bootstrap");
    assert!(error.to_string().contains("unknown builtin tool"));
}

// Scenario: selected tools and permissions have different key sets.
// Expected: ToolRuntime rejects the configuration during bootstrap.
// Invariant: every model-visible tool has exactly one declared permission.
#[tokio::test]
async fn permission_key_mismatch_is_rejected() {
    let temp = tempfile::tempdir().expect("tempdir should be available for test");
    let mut agent_config = config(&temp);
    agent_config.tool_names = vec!["read".into()];

    let error = Agent::create(agent_config)
        .err()
        .expect("permission mismatch must fail bootstrap");
    assert!(format!("{error:#}").contains("permission keys must match"));
}

// Scenario: an Ask permission is configured without an approval handler.
// Expected: bootstrap rejects the runtime before any turn can execute.
// Invariant: no Ask tool is executable without an explicit host approval boundary.
#[tokio::test]
async fn ask_without_handler_is_rejected() {
    let temp = tempfile::tempdir().expect("tempdir should be available for test");
    let mut agent_config = config(&temp);
    agent_config.tool_names = vec!["read".into()];
    agent_config
        .permissions
        .insert("read".into(), ToolPermission::Ask);

    let error = Agent::create(agent_config)
        .err()
        .expect("Ask without handler must fail bootstrap");
    assert!(format!("{error:#}").contains("approval handler"));
}

// Scenario: resolved config has invalid model, provider, bounds, or cwd values.
// Expected: validation fails before provider/session assembly.
// Invariant: invalid host paths and model bounds cannot produce partial runtime state.
#[tokio::test]
async fn invalid_config_values_are_rejected() {
    let temp = tempfile::tempdir().expect("tempdir should be available for test");
    let mut agent_config = config(&temp);
    agent_config.provider.model = String::new();
    assert!(Agent::create(agent_config).is_err());

    let mut agent_config = config(&temp);
    agent_config.provider.base_url = String::new();
    assert!(Agent::create(agent_config).is_err());

    let mut agent_config = config(&temp);
    agent_config.max_tokens = 0;
    assert!(Agent::create(agent_config).is_err());

    let mut agent_config = config(&temp);
    agent_config.max_steps = 0;
    assert!(Agent::create(agent_config).is_err());

    let mut agent_config = config(&temp);
    agent_config.cwd = PathBuf::from("missing-working-directory");
    assert!(Agent::create(agent_config).is_err());
}

// Scenario: a valid Agent enables Normal diagnostic persistence.
// Expected: the diagnostic worker starts and creates its active JSONL file.
// Invariant: enabling diagnostics does not change Session ownership or require a second runtime.
#[tokio::test]
async fn diagnostic_persistence_starts_worker() {
    let temp = tempfile::tempdir().expect("tempdir should be available for test");
    let mut agent_config = config(&temp);
    agent_config.persistence.diagnostic = crate::DiagnosticPersistence::Normal;
    let agent = Agent::create(agent_config).expect("normal diagnostic persistence should start");
    let status = agent
        .agent_event_log_status()
        .expect("diagnostic worker status should be exposed");
    assert_eq!(status.state, crate::AgentEventLogState::Running);
    assert!(temp
        .path()
        .join("runs")
        .read_dir()
        .expect("runs")
        .next()
        .is_some());
}

// Scenario: nested project directories contain AGENTS.md files at multiple ancestors.
// Expected: prompt instructions appear from the outermost directory to the cwd.
// Invariant: project instructions remain separate from the harness contract and are not reordered.
#[test]
fn project_instructions_merge_from_root_to_cwd() {
    let temp = tempfile::tempdir().expect("tempdir should be available for test");
    let nested = temp.path().join("nested");
    fs::create_dir_all(&nested).expect("nested project directory should be created");
    fs::write(temp.path().join("AGENTS.md"), "outer rule\n")
        .expect("outer AGENTS.md should be written");
    fs::write(nested.join("AGENTS.md"), "inner rule\n").expect("inner AGENTS.md should be written");

    let prompt = prompt::resolve(&nested, "session-1", &[], &BTreeMap::new(), false)
        .expect("project instructions should resolve");
    let content = prompt.content();

    assert!(
        content.find("outer rule").expect("outer rule is present")
            < content.find("inner rule").expect("inner rule is present")
    );
    assert!(
        content.find("inner rule").expect("inner rule is present")
            < content
                .find("# MoonTide Harness Contract")
                .expect("harness is present")
    );
}

// Scenario: a harness prompt is resolved with runtime identity and tool permissions.
// Expected: dynamic facts and the static contract are rendered into SystemPrompt.
// Invariant: user message text is not accepted by or copied into the prompt resolver.
#[test]
fn harness_prompt_contains_runtime_facts_without_user_text() {
    let temp = tempfile::tempdir().expect("tempdir should be available for test");
    let mut permissions = BTreeMap::new();
    permissions.insert("read".into(), ToolPermission::Allow);
    permissions.insert("write".into(), ToolPermission::Ask);
    let prompt = prompt::resolve(
        temp.path(),
        "session-42",
        &["write".into(), "read".into()],
        &permissions,
        true,
    )
    .expect("harness prompt should resolve");
    let content = prompt.content();

    assert!(content.contains("MoonTide agent harness"));
    assert!(content.contains("available capabilities"));
    assert!(content.contains("ToolResult is the only evidence"));
    assert!(content.contains("If no suitable tool is enabled"));
    assert!(content.contains(&format!("cwd: {}", temp.path().display())));
    assert!(content.contains("session_id: session-42"));
    assert!(content.contains("read: allow"));
    assert!(content.contains("write: ask"));
    assert!(content.contains("approval handler: available"));
    assert!(!content.contains("user message"));
}

// Scenario: project instructions change between two user turns.
// Expected: each resolver call observes the latest AGENTS.md content.
// Invariant: one resolved SystemPrompt remains immutable for the caller's current turn.
#[test]
fn project_instructions_reload_at_turn_resolution_boundary() {
    let temp = tempfile::tempdir().expect("tempdir should be available for test");
    let path = temp.path().join("AGENTS.md");
    fs::write(&path, "first rule\n").expect("initial AGENTS.md should be written");
    let first = prompt::resolve(temp.path(), "session-1", &[], &BTreeMap::new(), false)
        .expect("first prompt should resolve");

    fs::write(&path, "second rule\n").expect("updated AGENTS.md should be written");
    let second = prompt::resolve(temp.path(), "session-1", &[], &BTreeMap::new(), false)
        .expect("second prompt should resolve");

    assert!(first.content().contains("first rule"));
    assert!(!first.content().contains("second rule"));
    assert!(second.content().contains("second rule"));
}

// Scenario: AGENTS.md exists but is not valid UTF-8 instruction text.
// Expected: resolving the prompt fails instead of silently dropping project policy.
// Invariant: a present but unreadable instruction file is a bootstrap/turn error.
#[test]
fn unreadable_project_instructions_are_rejected() {
    let temp = tempfile::tempdir().expect("tempdir should be available for test");
    fs::write(temp.path().join("AGENTS.md"), [0xff, 0xfe])
        .expect("invalid UTF-8 AGENTS.md should be written");

    assert!(prompt::resolve(temp.path(), "session-1", &[], &BTreeMap::new(), false).is_err());
}

// Scenario: Agent bootstrap sees an unreadable project instruction file.
// Expected: create fails before returning an Agent facade.
// Invariant: project policy cannot silently disappear between bootstrap and the first turn.
#[tokio::test]
async fn bootstrap_rejects_unreadable_project_instructions() {
    let temp = tempfile::tempdir().expect("tempdir should be available for test");
    fs::write(temp.path().join("AGENTS.md"), [0xff, 0xfe])
        .expect("invalid UTF-8 AGENTS.md should be written");

    assert!(Agent::create(config(&temp)).is_err());
}
