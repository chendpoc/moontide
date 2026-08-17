use std::path::PathBuf;

use agent::{Agent, ContentBlock, ModelResponse, StopReason};

use crate::{
    approval::{parse_response, truncate_preview},
    args::{CliArgs, LaunchMode},
    config::{resolve_agent_config_with, session_mode, validate_prompt},
    render::{assistant_text, write_assistant_stdout},
    repl::{parse_command, ReplCommand},
};

// Scenario: clap parses one-shot and explicit path/model flags.
// Expected: parsed values select one-shot mode and preserve explicit inputs.
// Invariant: CLI parsing does not read environment variables or construct an Agent.
#[test]
fn args_select_one_shot_without_side_effects() {
    let args = <CliArgs as clap::Parser>::parse_from([
        "moontide",
        "--prompt",
        "inspect project",
        "--cwd",
        "workspace",
        "--model",
        "custom-model",
    ]);

    assert_eq!(args.launch_mode(), LaunchMode::OneShot);
    assert_eq!(args.prompt.as_deref(), Some("inspect project"));
    assert_eq!(args.cwd, Some(PathBuf::from("workspace")));
    assert_eq!(args.model, "custom-model");
}

// Scenario: no --prompt is supplied for either a new or resumed Session.
// Expected: dispatch selects the R1 REPL seam without entering Agent::turn.
// Invariant: session create/resume selection remains independent from launch mode.
#[test]
fn create_and_resume_dispatch_to_repl_seam() {
    let create = <CliArgs as clap::Parser>::parse_from(["moontide"]);
    let resume = <CliArgs as clap::Parser>::parse_from(["moontide", "--session", "session-1"]);

    assert_eq!(create.launch_mode(), LaunchMode::Repl);
    assert_eq!(session_mode(&create), "create");
    assert_eq!(resume.launch_mode(), LaunchMode::Repl);
    assert_eq!(session_mode(&resume), "resume");
}

// Scenario: config resolution receives an explicit API key and cwd.
// Expected: coding preset defaults, provider defaults, and cwd-based paths are materialized.
// Invariant: config resolution is deterministic and does not consult process environment in this seam.
#[test]
fn config_resolution_uses_explicit_inputs() {
    let args = <CliArgs as clap::Parser>::parse_from(["moontide", "--prompt", "hello"]);
    let cwd = PathBuf::from("project");
    let config = resolve_agent_config_with(&args, cwd.clone(), Some("secret".into()))
        .expect("explicit config should resolve");

    assert_eq!(config.cwd, cwd.clone());
    assert_eq!(config.provider.api_key, "secret");
    assert_eq!(config.provider.base_url, "https://api.deepseek.com");
    assert_eq!(config.model, "deepseek-chat");
    assert_eq!(config.sessions_dir, cwd.join(".moontide/sessions"));
    assert_eq!(config.tool_names.len(), 6);
    assert_eq!(config.max_tokens, super::config::DEFAULT_MAX_TOKENS);
}

// Scenario: API key is absent or whitespace-only.
// Expected: config resolution fails before provider/session construction.
// Invariant: credentials never become an empty provider config.
#[test]
fn missing_api_key_is_rejected() {
    let args = <CliArgs as clap::Parser>::parse_from(["moontide", "--prompt", "hello"]);
    assert!(resolve_agent_config_with(&args, PathBuf::from("project"), None).is_err());
    assert!(resolve_agent_config_with(&args, PathBuf::from("project"), Some("  ".into())).is_err());
}

// Scenario: resolved CLI config points at a missing working directory.
// Expected: Agent construction rejects the path before any provider request.
// Invariant: invalid CLI paths cannot create a runnable Session.
#[test]
fn invalid_working_directory_is_rejected_by_agent_boundary() {
    let args = <CliArgs as clap::Parser>::parse_from(["moontide", "--prompt", "hello"]);
    let config = resolve_agent_config_with(
        &args,
        PathBuf::from("missing-working-directory"),
        Some("secret".into()),
    )
    .expect("CLI config should resolve before Agent path validation");

    assert!(Agent::create(config).is_err());
}

// Scenario: one-shot prompt is absent or empty.
// Expected: validation rejects both forms before Agent::turn.
// Invariant: the Loop never receives an invalid empty user Turn from CLI dispatch.
#[test]
fn empty_prompt_is_rejected() {
    let no_prompt = <CliArgs as clap::Parser>::parse_from(["moontide"]);
    assert!(validate_prompt(&no_prompt).is_err());
    let empty_prompt = <CliArgs as clap::Parser>::parse_from(["moontide", "--prompt", ""]);
    assert!(validate_prompt(&empty_prompt).is_err());
}

// Scenario: a ModelResponse contains text, thinking, and non-terminal tool blocks.
// Expected: renderer emits only assistant text and keeps thinking/tool content out of stdout.
// Invariant: final output is derived from ModelResponse, not streamed snapshots or diagnostics.
#[test]
fn renderer_keeps_stdout_to_final_assistant_text() {
    let response = ModelResponse {
        content: vec![
            ContentBlock::Thinking {
                thinking: "internal".into(),
            },
            ContentBlock::Text {
                text: "answer".into(),
            },
            ContentBlock::ToolUse {
                id: "tool-1".into(),
                name: "read".into(),
                input: serde_json::json!({"path": "README.md"}),
            },
        ],
        stop_reason: StopReason::EndTurn,
        usage: None,
        model: Some("deepseek-chat".into()),
    };
    let mut output = Vec::new();
    write_assistant_stdout(&response, &mut output).expect("stdout rendering should succeed");

    assert_eq!(assistant_text(&response), "answer");
    assert_eq!(
        String::from_utf8(output).expect("renderer output is UTF-8"),
        "answer\n"
    );
}

// Scenario: REPL command lines contain supported slash commands or ordinary user text.
// Expected: commands are classified without entering Agent::turn; other lines preserve text.
// Invariant: command dispatch remains a CLI-shell concern and does not mutate Session facts.
#[test]
fn repl_commands_are_classified_without_agent_access() {
    assert_eq!(parse_command("/id".into()), ReplCommand::SessionId);
    assert_eq!(parse_command("/help".into()), ReplCommand::Help);
    assert_eq!(parse_command("/exit".into()), ReplCommand::Exit);
    assert_eq!(
        parse_command("continue the task".into()),
        ReplCommand::Turn("continue the task".into())
    );
}

// Scenario: terminal approval receives y/n/empty/unknown responses and a long JSON input.
// Expected: y approves, n/empty/unknown deny, and the preview is bounded.
// Invariant: approval prompt rendering never exposes unbounded tool input to stderr.
#[test]
fn approval_responses_and_preview_are_bounded() {
    assert_eq!(parse_response("y\n"), agent::ToolApproval::Approved);
    assert!(matches!(
        parse_response("n\n"),
        agent::ToolApproval::Denied { .. }
    ));
    assert!(matches!(
        parse_response("\n"),
        agent::ToolApproval::Denied { .. }
    ));
    assert!(matches!(
        parse_response("maybe\n"),
        agent::ToolApproval::Denied { .. }
    ));
    let preview = truncate_preview(&"x".repeat(600));
    assert!(preview.chars().count() <= 513);
    assert!(preview.ends_with('…'));
}
