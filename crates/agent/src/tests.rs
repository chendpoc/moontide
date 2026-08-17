use std::{collections::BTreeMap, path::PathBuf};

use agent_core::{
    llm::{adapter::AdapterFamily, protocol::ThinkingLevel},
    r#loop::ToolPermission,
};
use tempfile::TempDir;

use crate::{Agent, AgentConfig, ProviderConfig};

fn config(temp: &TempDir) -> AgentConfig {
    AgentConfig {
        cwd: temp.path().to_path_buf(),
        sessions_dir: temp.path().join("sessions"),
        runs_dir: temp.path().join("runs"),
        provider: ProviderConfig {
            family: AdapterFamily::OpenAiChatCompletions,
            base_url: "https://example.com/v1".into(),
            api_key: "test-key".into(),
        },
        model: "test-model".into(),
        max_tokens: 128,
        thinking_level: Some(ThinkingLevel::Off),
        max_steps: 4,
        tool_names: Vec::new(),
        permissions: BTreeMap::new(),
        approval: None,
    }
}

// Scenario: a fully resolved minimal config is bootstrapped without network access.
// Expected: Agent creation succeeds and creates non-empty stable session identity.
// Invariant: provider construction is local; no API request is made during bootstrap.
#[test]
fn create_builds_minimal_agent() {
    let temp = tempfile::tempdir().expect("tempdir should be available for test");
    let agent = Agent::create(config(&temp)).expect("minimal agent should bootstrap");

    assert!(!agent.session_id().is_empty());
    assert!(temp.path().join("sessions").is_dir());
    assert!(temp.path().join("runs").is_dir());
}

// Scenario: a created session is reopened through the composition root.
// Expected: resume returns the same Session identity.
// Invariant: loading does not create a second session log for the supplied id.
#[test]
fn resume_preserves_session_identity() {
    let temp = tempfile::tempdir().expect("tempdir should be available for test");
    let created = Agent::create(config(&temp)).expect("minimal agent should bootstrap");
    let session_id = created.session_id().to_owned();
    drop(created);

    let resumed = Agent::resume(config(&temp), &session_id).expect("session should resume");
    assert_eq!(resumed.session_id(), session_id);
}

// Scenario: config contains a tool name absent from the first-party catalog.
// Expected: bootstrap fails before constructing a runnable Agent.
// Invariant: unknown capabilities are rejected at composition time, not on first model call.
#[test]
fn unknown_tool_is_rejected_during_bootstrap() {
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
#[test]
fn permission_key_mismatch_is_rejected() {
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
#[test]
fn ask_without_handler_is_rejected() {
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

// Scenario: resolved config has an empty model and a non-directory cwd.
// Expected: validation fails before provider/session assembly.
// Invariant: invalid host paths and model bounds cannot produce partial runtime state.
#[test]
fn invalid_config_values_are_rejected() {
    let temp = tempfile::tempdir().expect("tempdir should be available for test");
    let mut agent_config = config(&temp);
    agent_config.model = String::new();
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
