mod approval;
mod args;
mod config;
mod fuzzy;
mod input;
mod render;
mod repl;
mod setting_catalog;
mod settings;
mod settings_ui;
mod trace;

use std::{future::Future, io, process::ExitCode};

use agent::{Agent, AgentConfig};
use anyhow::{bail, Context, Result};
use args::{CliArgs, LaunchMode};
use clap::Parser;
use config::{resolve_agent_config, session_mode, validate_prompt};
use input::InputOwner;
use render::write_assistant_stdout;
use repl::{await_turn_with_ctrl_c, run as run_repl, TurnOutcome};
use settings::{resolve_interactive, resolve_one_shot};
use tokio_util::sync::CancellationToken;

#[cfg(test)]
mod tests;

#[tokio::main]
async fn main() -> ExitCode {
    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            let _ = render::write_diagnostic_stderr(&format!("ERROR: {error:#}"));
            ExitCode::FAILURE
        }
    }
}

async fn run() -> Result<()> {
    let args = CliArgs::parse();
    let prompt = match args.launch_mode() {
        LaunchMode::OneShot => Some(validate_prompt(&args)?.to_owned()),
        LaunchMode::Repl => None,
    };
    let (settings, input_owner) = match args.launch_mode() {
        LaunchMode::OneShot => (resolve_one_shot(&args)?, None),
        LaunchMode::Repl => {
            let input_owner = InputOwner::new()?;
            let settings = resolve_interactive(&args, input_owner.clone())?;
            (settings, Some(input_owner))
        }
    };
    let config = resolve_agent_config(&args, &settings)?;
    let sessions_dir = config.sessions_dir.clone();
    let defer_create = matches!(args.launch_mode(), LaunchMode::Repl) && args.session.is_none();
    let (mut agent, mut pending_config): (Option<Agent>, Option<AgentConfig>) = if defer_create {
        (None, Some(config))
    } else {
        let active_agent = match args.session.as_deref() {
            Some(session_id) => Agent::resume(config, session_id)?,
            None => Agent::create(config)?,
        };
        (Some(active_agent), None)
    };

    if let Some(active_agent) = agent.as_ref() {
        let _ = render::write_diagnostic_stderr(&format!(
            "session ({}) id: {}",
            session_mode(&args),
            active_agent.session_id()
        ));
    } else {
        write_recent_session_hint(&sessions_dir)?;
    }

    match (args.launch_mode(), prompt) {
        (LaunchMode::OneShot, Some(prompt)) => {
            let cancellation = CancellationToken::new();
            let active_agent = agent
                .as_mut()
                .ok_or_else(|| anyhow::anyhow!("one-shot mode requires an active agent"))?;
            let session_id = active_agent.session_id().to_owned();
            let outcome = finalize_turn(
                await_turn_with_ctrl_c(
                    active_agent.turn(prompt, cancellation.clone()),
                    cancellation,
                    tokio::signal::ctrl_c(),
                )
                .await,
                flush_progress(active_agent),
                flush_agent_event_log(active_agent),
            )
            .await?;
            let result = match outcome {
                TurnOutcome::Completed(Ok(response)) => {
                    write_assistant_stdout(&response, std::io::stdout().lock())?;
                    Ok(())
                }
                TurnOutcome::Completed(Err(error)) => Err(error),
                TurnOutcome::Cancelled => bail!("cancelled"),
            };
            write_resume_hint(&session_id)?;
            result
        }
        (LaunchMode::Repl, None) => {
            let mut runtime_settings = settings;
            let repl_result = run_repl(
                &mut agent,
                &mut pending_config,
                input_owner.ok_or_else(|| anyhow::anyhow!("interactive input owner missing"))?,
                &args,
                &mut runtime_settings,
            )
            .await;
            if let Some(active_agent) = agent.as_ref() {
                write_resume_hint(active_agent.session_id())?;
            }
            repl_result
        }
        _ => bail!("invalid CLI launch state"),
    }
}

pub(crate) async fn flush_progress(agent: &Agent) -> Result<()> {
    let flush_result = agent.flush_progress().await;
    let resync_required = agent.take_progress_resync_required();
    let status = agent.progress_status();
    report_progress_diagnostics(
        flush_result,
        resync_required,
        status.as_ref(),
        render::write_diagnostic_stderr,
    )
}

pub(crate) async fn finalize_turn<ProgressFlush, LogFlush>(
    turn_result: Result<TurnOutcome>,
    progress_flush: ProgressFlush,
    log_flush: LogFlush,
) -> Result<TurnOutcome>
where
    ProgressFlush: Future<Output = Result<()>>,
    LogFlush: Future<Output = ()>,
{
    let progress_result = progress_flush.await;
    log_flush.await;
    progress_result?;
    turn_result
}

pub(crate) fn report_progress_diagnostics<WriteDiagnostic>(
    flush_result: Result<()>,
    resync_required: bool,
    status: Option<&agent::ProgressStatus>,
    mut write_diagnostic: WriteDiagnostic,
) -> Result<()>
where
    WriteDiagnostic: FnMut(&str) -> io::Result<()>,
{
    if let Err(error) = flush_result {
        write_diagnostic(&format!("ERROR: Progress flush failed: {error:#}"))
            .context("write Progress flush diagnostic")?;
    }
    if let Some(status) = status {
        for message in progress_status_messages(status, resync_required) {
            write_diagnostic(&message).context("write Progress status diagnostic")?;
        }
    }
    Ok(())
}

pub(crate) fn progress_status_messages(
    status: &agent::ProgressStatus,
    resync_required: bool,
) -> Vec<String> {
    let mut messages = Vec::new();
    if resync_required {
        messages.push(
            "WARNING: Progress events were dropped; frontend state requires resync from session facts"
                .into(),
        );
    }
    if status.state != agent::ProgressWorkerState::Running {
        messages.push(format!(
            "WARNING: Progress worker state={:?}, dropped_events={}, last_error={}",
            status.state,
            status.dropped_events,
            status.last_error.as_deref().unwrap_or("none")
        ));
    }
    messages
}

pub(crate) async fn flush_agent_event_log(agent: &Agent) {
    if let Err(error) = agent.flush_agent_event_log().await {
        let _ = render::write_diagnostic_stderr(&format!(
            "ERROR: diagnostic Agent Event Log flush failed: {error:#}"
        ));
    }
    if let Some(status) = agent.agent_event_log_status() {
        if status.state != agent::AgentEventLogState::Running {
            let _ = render::write_diagnostic_stderr(&format!(
                "WARNING: diagnostic Agent Event Log state={:?}, dropped_events={}, last_error={}",
                status.state,
                status.dropped_events,
                status.last_error.as_deref().unwrap_or("none")
            ));
        }
    }
}

fn write_recent_session_hint(sessions_dir: &std::path::Path) -> Result<()> {
    match agent::latest_session_id(sessions_dir)? {
        Some(session_id) => render::write_diagnostic_stderr(&format!(
            "last session id: {session_id}\nTo resume it, run: moontide --session {session_id}\nA new session will be created when you send your first message."
        ))?,
        None => render::write_diagnostic_stderr(
            "No previous session found. A new session will be created when you send your first message.",
        )?,
    }
    Ok(())
}

fn write_resume_hint(session_id: &str) -> Result<()> {
    render::write_diagnostic_stderr(&format!(
        "To resume this session, run: moontide --session {session_id}"
    ))?;
    Ok(())
}
