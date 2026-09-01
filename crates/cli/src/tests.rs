use std::{
    future, io,
    io::Write,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

use agent::{ContentBlock, ModelResponse, StopReason};
use tempfile::tempdir;

use crate::{
    approval::{parse_response, truncate_preview},
    args::{CliArgs, LaunchMode},
    config::{resolve_agent_config_with, session_mode, validate_prompt},
    finalize_turn, progress_status_messages,
    render::{assistant_text, write_assistant_stdout},
    repl::{await_turn_with_ctrl_c, parse_command, ReplCommand, TurnOutcome},
    report_progress_diagnostics,
    settings::{ApprovalPolicy, GlobalConfigStore, TraceMode},
    trace::format_progress_event,
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
    assert_eq!(args.model.as_deref(), Some("custom-model"));
    assert_eq!(args.approval_policy, None);
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
    let directory = tempdir().expect("temporary project directory");
    let cwd = directory.path().to_owned();
    let config = resolve_agent_config_with(
        &args,
        cwd.clone(),
        &runtime_settings("secret", ApprovalPolicy::Default),
    )
    .expect("explicit config should resolve");

    assert_eq!(config.cwd, cwd.clone());
    assert_eq!(config.provider.api_key, "secret");
    assert_eq!(config.provider.base_url, "https://api.deepseek.com");
    assert_eq!(config.provider.model, "deepseek-chat");
    assert_eq!(config.sessions_dir, cwd.join(".moontide/sessions"));
    assert_eq!(config.tool_names.len(), 6);
    assert_eq!(config.max_tokens, super::config::DEFAULT_MAX_TOKENS);
}

// Scenario: runtime Settings selects the Always approval policy.
// Expected: every coding-preset tool is represented as Ask in AgentConfig.
// Invariant: policy materialization happens in the CLI and does not add a Loop policy type.
#[test]
fn always_approval_policy_maps_all_tools_to_ask() {
    let args = <CliArgs as clap::Parser>::parse_from(["moontide", "--prompt", "hello"]);
    let directory = tempdir().expect("temporary project directory");
    let config = resolve_agent_config_with(
        &args,
        directory.path().to_owned(),
        &runtime_settings("secret", ApprovalPolicy::Always),
    )
    .expect("always approval config should resolve");

    assert!(config
        .permissions
        .values()
        .all(|permission| matches!(permission, agent::ToolPermission::Ask)));
}

// Scenario: runtime Settings selects the AlwaysAllow approval policy.
// Expected: every coding-preset tool is Allow and no approval handler is installed.
// Invariant: always-allow is an explicit CLI mode, not an implicit Loop behavior.
#[test]
fn always_allow_policy_maps_all_tools_to_allow() {
    let args = <CliArgs as clap::Parser>::parse_from(["moontide", "--prompt", "hello"]);
    let directory = tempdir().expect("temporary project directory");
    let config = resolve_agent_config_with(
        &args,
        directory.path().to_owned(),
        &runtime_settings("secret", ApprovalPolicy::AlwaysAllow),
    )
    .expect("always-allow config should resolve");

    assert!(config
        .permissions
        .values()
        .all(|permission| matches!(permission, agent::ToolPermission::Allow)));
    assert!(config.approval.is_none());
}

// Scenario: API key is absent or whitespace-only.
// Expected: config resolution fails before provider/session construction.
// Invariant: credentials never become an empty provider config.
#[test]
fn missing_api_key_is_rejected() {
    let args = <CliArgs as clap::Parser>::parse_from(["moontide", "--prompt", "hello"]);
    let empty_settings = runtime_settings("", ApprovalPolicy::Default);
    assert!(resolve_agent_config_with(&args, PathBuf::from("project"), &empty_settings).is_err());
    let args_with_empty_key =
        <CliArgs as clap::Parser>::parse_from(["moontide", "--prompt", "hello", "--api-key", "  "]);
    assert!(resolve_agent_config_with(
        &args_with_empty_key,
        PathBuf::from("project"),
        &runtime_settings("secret", ApprovalPolicy::Default),
    )
    .is_err());
}

// Scenario: resolved CLI config points at a missing working directory.
// Expected: Agent construction rejects the path before any provider request.
// Invariant: invalid CLI paths cannot create a runnable Session.
#[test]
fn invalid_working_directory_is_rejected_by_agent_boundary() {
    let args = <CliArgs as clap::Parser>::parse_from(["moontide", "--prompt", "hello"]);
    let result = resolve_agent_config_with(
        &args,
        PathBuf::from("missing-working-directory"),
        &runtime_settings("secret", ApprovalPolicy::Default),
    );

    assert!(result.is_err());
}

// Scenario: Agnes provider resolves through CLI settings.
// Expected: base URL and model match the Agnes catalog defaults.
// Invariant: provider selection stays in the CLI host layer and resolves one provider bundle.
#[test]
fn agnes_provider_preset_resolves_defaults() {
    let directory = tempdir().expect("temporary project directory");
    let args = <CliArgs as clap::Parser>::parse_from([
        "moontide",
        "--prompt",
        "hello",
        "--provider",
        "agnes",
        "--api-key",
        "secret",
        "--cwd",
        directory.path().to_str().expect("UTF-8 temp path"),
    ]);
    let settings = crate::settings::load_global_config_store(&args).expect("global config store");
    let config = resolve_agent_config_with(&args, directory.path().to_owned(), &settings)
        .expect("agnes config should resolve");

    assert_eq!(config.provider.provider_id, agent::ProviderId::Agnes);
    assert_eq!(config.provider.model, "agnes-2.5-flash");
    assert_eq!(config.provider.base_url, "https://api.agnes-ai.cn/v1");
    assert_eq!(
        config.provider.family,
        agent::AdapterFamily::OpenAiChatCompletions
    );
}

fn runtime_settings(api_key: &str, approval_policy: ApprovalPolicy) -> GlobalConfigStore {
    GlobalConfigStore {
        provider: agent::ProviderId::Deepseek,
        api_key: api_key.into(),
        approval_policy,
        trace_mode: TraceMode::Off,
        model: "deepseek-chat".into(),
        base_url: "https://api.deepseek.com".into(),
        max_tokens: super::config::DEFAULT_MAX_TOKENS,
        max_steps: super::config::DEFAULT_MAX_STEPS,
        thinking_level: None,
        persistence: agent::PersistenceConfig::default(),
        input_owner: None,
    }
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
    assert_eq!(parse_command("/settings".into()), ReplCommand::Settings);
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

// Scenario: Ctrl-C wins while a Turn future is still pending.
// Expected: the cancellation token is set and the Turn future is awaited for cleanup.
// Invariant: cancellation never detaches an in-flight Agent turn from the REPL owner.
#[tokio::test]
async fn ctrl_c_cancels_and_awaits_turn_cleanup() {
    let cancellation = tokio_util::sync::CancellationToken::new();
    let cleaned_up = Arc::new(AtomicBool::new(false));
    let cleanup_flag = Arc::clone(&cleaned_up);
    let (signal_tx, signal_rx) = tokio::sync::oneshot::channel();
    let turn = async move {
        signal_rx.await.expect("signal should release turn cleanup");
        cleanup_flag.store(true, Ordering::SeqCst);
        Ok(ModelResponse {
            content: vec![ContentBlock::Text {
                text: "ignored".into(),
            }],
            stop_reason: StopReason::EndTurn,
            usage: None,
            model: None,
        })
    };
    let outcome = await_turn_with_ctrl_c(turn, cancellation.clone(), async move {
        signal_tx
            .send(())
            .map_err(|_| io::Error::other("turn cleanup receiver dropped"))?;
        Ok::<(), io::Error>(())
    })
    .await
    .expect("Ctrl-C signal should resolve");

    assert!(cancellation.is_cancelled());
    assert!(cleaned_up.load(Ordering::SeqCst));
    assert!(matches!(outcome, TurnOutcome::Cancelled));
}

// Scenario: a Turn completes while the Ctrl-C future remains pending.
// Expected: the final response wins and the cancellation token remains active.
// Invariant: a late Ctrl-C cannot discard a response that already completed.
#[tokio::test]
async fn completed_turn_wins_pending_ctrl_c() {
    let cancellation = tokio_util::sync::CancellationToken::new();
    let outcome = await_turn_with_ctrl_c(
        async {
            Ok::<_, anyhow::Error>(ModelResponse {
                content: vec![ContentBlock::Text {
                    text: "answer".into(),
                }],
                stop_reason: StopReason::EndTurn,
                usage: None,
                model: None,
            })
        },
        cancellation.clone(),
        future::pending::<io::Result<()>>(),
    )
    .await
    .expect("completed turn should resolve");

    assert!(!cancellation.is_cancelled());
    assert!(matches!(outcome, TurnOutcome::Completed(Ok(_))));
}

// Scenario: trace mode renders semantic progress events for CLI diagnostics.
// Expected: tool/LLM lifecycle is visible, while thinking from snapshots remains opt-in.
// Invariant: trace output is stderr-facing presentation and does not alter final assistant stdout.
#[test]
fn trace_mode_renders_events_and_opt_in_thinking() {
    let tool = agent::ProgressEvent::ToolCall {
        turn: 1,
        call: agent::ToolCall::new("tool-1", "bash", serde_json::json!({"command": "pwd"}))
            .expect("tool call should be valid"),
    };
    let thinking = agent::ProgressEvent::AssistantResponseSnapshot {
        turn: 1,
        step: 0,
        llm_call_id: "call-1".into(),
        update_index: 0,
        snapshot: agent::ModelResponseSnapshot {
            content: Vec::new(),
            pending: Some(agent::PendingBlock::Thinking {
                thinking: "inspect workspace".into(),
            }),
            stop_reason: None,
            usage: None,
            model: None,
        },
    };

    assert!(format_progress_event(TraceMode::Events, &tool)
        .expect("tool event should render")
        .contains("tool=bash"));
    assert!(format_progress_event(TraceMode::Events, &thinking).is_none());
    assert!(
        format_progress_event(TraceMode::EventsAndThinking, &thinking)
            .expect("thinking event should render")
            .contains("thinking: inspect workspace")
    );
}

// Scenario: the Progress worker reports dropped events and a degraded state at turn completion.
// Expected: CLI produces stderr-facing resync and worker diagnostics instead of silently discarding them.
// Invariant: status formatting does not alter assistant stdout or reconstruct state from Agent Event JSONL.
#[test]
fn progress_status_reports_resync_and_worker_error() {
    let status = agent::ProgressStatus {
        state: agent::ProgressWorkerState::Degraded,
        queue_capacity: 256,
        queue_len: 0,
        dropped_events: 2,
        resync_required: true,
        last_error: Some("observer failed".into()),
    };

    let messages = progress_status_messages(&status, true);
    assert_eq!(messages.len(), 2);
    assert!(messages[0].contains("resync"));
    assert!(messages[1].contains("dropped_events=2"));
    assert!(messages[1].contains("observer failed"));
}

// Scenario: Progress flushing fails while the CLI has a diagnostic sink available.
// Expected: the flush failure is formatted and written through the diagnostic boundary.
// Invariant: a worker failure is not silently discarded; only the sink's own I/O error is propagated.
#[test]
fn progress_flush_error_is_written_to_diagnostic_sink() {
    let mut output = Vec::new();
    report_progress_diagnostics(
        Err(anyhow::anyhow!("worker stopped")),
        false,
        None,
        |message| writeln!(output, "{message}"),
    )
    .expect("diagnostic sink should accept the flush error");

    let output = String::from_utf8(output).expect("diagnostic output should be UTF-8");
    assert!(output.contains("ERROR: Progress flush failed"));
    assert!(output.contains("worker stopped"));
}

// Scenario: Ctrl-C signal handling returns an I/O error after cancelling an in-flight Turn.
// Expected: shared turn finalization still flushes Progress and Agent Event Log before returning the signal error.
// Invariant: signal failure cannot bypass either persistence/diagnostic flush boundary.
#[tokio::test]
async fn signal_error_still_runs_turn_flushes() {
    let cancellation = tokio_util::sync::CancellationToken::new();
    let (release_tx, release_rx) = tokio::sync::oneshot::channel();
    let turn = async move {
        release_rx
            .await
            .map_err(|_| anyhow::anyhow!("turn release sender dropped"))?;
        Ok::<_, anyhow::Error>(ModelResponse {
            content: vec![ContentBlock::Text {
                text: "ignored".into(),
            }],
            stop_reason: StopReason::EndTurn,
            usage: None,
            model: None,
        })
    };
    let turn_result = await_turn_with_ctrl_c(turn, cancellation.clone(), async move {
        release_tx
            .send(())
            .map_err(|_| io::Error::other("turn cleanup receiver dropped"))?;
        Err::<(), _>(io::Error::other("signal failed"))
    })
    .await;

    let progress_flushed = Arc::new(AtomicBool::new(false));
    let progress_flushed_flag = Arc::clone(&progress_flushed);
    let log_flushed = Arc::new(AtomicBool::new(false));
    let log_flushed_flag = Arc::clone(&log_flushed);
    let result = finalize_turn(
        turn_result,
        async move {
            progress_flushed_flag.store(true, Ordering::SeqCst);
            Ok(())
        },
        async move {
            log_flushed_flag.store(true, Ordering::SeqCst);
        },
    )
    .await;

    assert!(result.is_err());
    assert!(cancellation.is_cancelled());
    assert!(progress_flushed.load(Ordering::SeqCst));
    assert!(log_flushed.load(Ordering::SeqCst));
}

// Scenario: CLI startup sources are scanned for forbidden direct catalog imports.
// Expected: checked modules import agent::llm instead of reaching into agent-core catalog.
// Invariant: catalog ownership stays in agent::llm for all hosts.
#[test]
fn cli_does_not_import_agent_core_llm_catalog_directly() {
    const FORBIDDEN: &str = "agent_core::llm::catalog";
    let sources = [
        include_str!("settings.rs"),
        include_str!("config.rs"),
        include_str!("setting_catalog.rs"),
        include_str!("args.rs"),
        include_str!("main.rs"),
    ];
    for source in sources {
        assert!(
            !source.contains(FORBIDDEN),
            "CLI must not import agent-core LLM catalog directly"
        );
    }
}
