use std::future::Future;
use std::io;
use std::sync::Arc;

use agent::{
    Agent,
    ModelResponse,
    SessionQuery,
};
use anyhow::{
    Context,
    Result,
};
use rustyline::error::ReadlineError;
use tokio_util::sync::CancellationToken;

use crate::args::CliArgs;
use crate::config::{
    resolve_agent_config,
    resolve_project_paths,
};
use crate::console_render::{
    ConsoleRenderer,
    format_resume_preview,
    format_session_list,
    short_session_id,
};
use crate::input::{
    InputOwner,
    normalize_input,
};
use crate::render::{
    write_assistant_text,
    write_diagnostic_stderr,
};
use crate::settings::GlobalConfigStore;
use crate::settings_ui::run_settings_ui;

const HELP: &str = "\
/status     show model, session, cwd, and policies
/id         show active session id
/sessions   list persisted sessions
/resume id  load an existing session (omit id for latest)
/new        start a new session
/settings   open settings overlay
/thinking   on|off  show model thinking in the console
/help       show this help
/exit       exit the console
End a line with \\ to continue a multi-line message.";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ConsoleCommand {
    Exit,
    Help,
    SessionId,
    Settings,
    Status,
    NewSession,
    ListSessions,
    Resume(Option<String>),
    Thinking(Option<bool>),
    Unknown(String),
    Turn(String),
}

pub(crate) enum TurnOutcome {
    Completed(Result<ModelResponse>),
    Cancelled,
}

pub(crate) fn parse_command(line: String) -> ConsoleCommand {
    let trimmed = line.trim();
    match trimmed {
        "/exit" => ConsoleCommand::Exit,
        "/help" => ConsoleCommand::Help,
        "/id" => ConsoleCommand::SessionId,
        "/settings" => ConsoleCommand::Settings,
        "/status" => ConsoleCommand::Status,
        "/new" => ConsoleCommand::NewSession,
        "/sessions" => ConsoleCommand::ListSessions,
        "/resume" => ConsoleCommand::Resume(None),
        "/thinking" => ConsoleCommand::Thinking(None),
        "/thinking on" => ConsoleCommand::Thinking(Some(true)),
        "/thinking off" => ConsoleCommand::Thinking(Some(false)),
        other if other.starts_with("/resume ") => {
            let id = other["/resume ".len()..].trim();
            if id.is_empty() {
                ConsoleCommand::Resume(None)
            } else {
                ConsoleCommand::Resume(Some(id.to_owned()))
            }
        }
        other if other.starts_with('/') => ConsoleCommand::Unknown(other.to_owned()),
        _ => ConsoleCommand::Turn(line),
    }
}

pub(crate) fn prompt_text(agent: Option<&Agent>) -> String {
    match agent {
        Some(agent) => format!("moontide:{}> ", short_session_id(agent.session_id())),
        None => "moontide> ".into(),
    }
}

pub(crate) async fn run(
    agent: &mut Option<Agent>,
    input_owner: InputOwner,
    args: &CliArgs,
    settings: &mut GlobalConfigStore,
    renderer: &ConsoleRenderer,
) -> Result<()> {
    loop {
        match input_owner.readline(&prompt_text(agent.as_ref())) {
            Ok(line) => {
                let line = normalize_input(line);
                if !line.trim().is_empty() {
                    input_owner
                        .add_history_entry(line.as_str())
                        .map_err(anyhow::Error::new)?;
                }
                match parse_command(line) {
                    ConsoleCommand::Exit => return Ok(()),
                    ConsoleCommand::Help => {
                        write_diagnostic_stderr(HELP).context("write console help")?;
                    }
                    ConsoleCommand::SessionId => write_session_id(agent.as_ref())?,
                    ConsoleCommand::Status => {
                        write_status(agent.as_ref(), args, settings, renderer)?;
                    }
                    ConsoleCommand::Settings => {
                        settings.input_owner = Some(input_owner.clone());
                        tokio::task::block_in_place(|| {
                            tokio::runtime::Handle::current().block_on(run_settings_ui(
                                settings,
                                agent.as_mut(),
                                args,
                            ))
                        })?;
                    }
                    ConsoleCommand::ListSessions => list_sessions(agent.as_ref(), args)?,
                    ConsoleCommand::NewSession => {
                        create_session(agent, args, settings).await?;
                    }
                    ConsoleCommand::Resume(session_id) => {
                        resume_session(agent, args, settings, session_id.as_deref()).await?;
                    }
                    ConsoleCommand::Thinking(value) => {
                        apply_thinking(renderer, value)?;
                    }
                    ConsoleCommand::Unknown(command) => {
                        write_diagnostic_stderr(&format!("unknown command: {command}\n{HELP}"))
                            .context("write unknown console command")?;
                    }
                    ConsoleCommand::Turn(text) => {
                        if text.trim().is_empty() {
                            continue;
                        }
                        ensure_session(agent, args, settings).await?;
                        run_turn(agent.as_mut(), renderer, text).await?;
                    }
                }
            }
            Err(ReadlineError::Interrupted) => {
                write_diagnostic_stderr("cancelled").context("write console interruption")?;
            }
            Err(ReadlineError::Eof) => return Ok(()),
            Err(error) => return Err(anyhow::Error::new(error).context("read console input")),
        }
    }
}

async fn run_turn(
    agent: Option<&mut Agent>,
    renderer: &ConsoleRenderer,
    text: String,
) -> Result<()> {
    let active_agent =
        agent.ok_or_else(|| anyhow::anyhow!("active agent missing after creation"))?;
    renderer.begin_turn()?;
    let cancellation = CancellationToken::new();
    let outcome = super::finalize_turn(
        await_turn_with_ctrl_c(
            active_agent.turn(text, cancellation.clone()),
            cancellation,
            tokio::signal::ctrl_c(),
        )
        .await,
        super::flush_progress(active_agent),
        super::flush_agent_event_log(active_agent),
    )
    .await?;
    match outcome {
        TurnOutcome::Completed(Ok(response)) => {
            if let Some(text) = renderer.fallback_assistant_text(&response)? {
                write_assistant_text(text, std::io::stdout().lock())
                    .context("write console assistant output")?;
            } else {
                renderer.ensure_stdout_newline()?;
            }
        }
        TurnOutcome::Completed(Err(error)) => {
            renderer.ensure_stdout_newline()?;
            write_diagnostic_stderr(&format!("ERROR: {error:#}"))
                .context("write console turn error")?;
        }
        TurnOutcome::Cancelled => {
            renderer.ensure_stdout_newline()?;
            write_diagnostic_stderr("cancelled").context("write console cancellation")?;
        }
    }
    Ok(())
}

async fn ensure_session(
    agent: &mut Option<Agent>,
    args: &CliArgs,
    settings: &GlobalConfigStore,
) -> Result<()> {
    if agent.is_some() {
        return Ok(());
    }
    create_session(agent, args, settings).await
}

async fn create_session(
    agent: &mut Option<Agent>,
    args: &CliArgs,
    settings: &GlobalConfigStore,
) -> Result<()> {
    flush_active(agent).await?;
    let config = resolve_agent_config(args, settings)?;
    let created = Agent::create(config).context("create session")?;
    write_diagnostic_stderr(&format!("session (create) id: {}", created.session_id()))
        .context("write created session id")?;
    *agent = Some(created);
    Ok(())
}

async fn resume_session(
    agent: &mut Option<Agent>,
    args: &CliArgs,
    settings: &GlobalConfigStore,
    session_id: Option<&str>,
) -> Result<()> {
    let paths = resolve_project_paths(args)?;
    let session_id = match session_id {
        Some(session_id) => session_id.to_owned(),
        None => agent::latest_session_id(&paths.sessions_dir)?
            .ok_or_else(|| anyhow::anyhow!("no persisted session to resume"))?,
    };
    flush_active(agent).await?;
    let config = resolve_agent_config(args, settings)?;
    let resumed = Agent::resume(config, &session_id)
        .with_context(|| format!("resume session {session_id}"))?;
    write_diagnostic_stderr(&format!("session (resume) id: {}", resumed.session_id()))
        .context("write resumed session id")?;
    if let Ok(snapshot) = SessionQuery::new(paths.sessions_dir).load(resumed.session_id()) {
        let preview = format_resume_preview(&snapshot);
        if !preview.is_empty() {
            write_diagnostic_stderr(&preview).context("write session resume preview")?;
        }
    }
    *agent = Some(resumed);
    Ok(())
}

async fn flush_active(agent: &mut Option<Agent>) -> Result<()> {
    if let Some(active) = agent.as_ref() {
        super::flush_progress(active).await?;
        super::flush_agent_event_log(active).await;
    }
    Ok(())
}

fn write_session_id(agent: Option<&Agent>) -> Result<()> {
    match agent {
        Some(active_agent) => {
            write_diagnostic_stderr(&format!("session id: {}", active_agent.session_id()))
                .context("write console session id")?
        }
        None => {
            write_diagnostic_stderr("no active session").context("write console session status")?
        }
    }
    Ok(())
}

fn write_status(
    agent: Option<&Agent>,
    args: &CliArgs,
    settings: &GlobalConfigStore,
    renderer: &ConsoleRenderer,
) -> Result<()> {
    let paths = resolve_project_paths(args)?;
    let session = agent
        .map(|active| active.session_id().to_owned())
        .unwrap_or_else(|| "none".into());
    let thinking = if renderer.is_thinking_visible() {
        "on"
    } else {
        "off"
    };
    let thinking_level = match settings.thinking_level {
        Some(level) => format!("{level:?}").to_ascii_lowercase(),
        None => "off".into(),
    };
    write_diagnostic_stderr(&format!(
        "session: {session}\nprovider: {}\nmodel: {}\ncwd: {}\napproval: {:?}\ntrace: {:?}\nthinking display: {thinking}\nthinking level: {thinking_level}",
        settings.provider,
        settings.model,
        paths.cwd.display(),
        settings.approval_policy,
        settings.trace_mode,
    ))
    .context("write console status")?;
    Ok(())
}

fn list_sessions(agent: Option<&Agent>, args: &CliArgs) -> Result<()> {
    let paths = resolve_project_paths(args)?;
    let summaries = SessionQuery::new(paths.sessions_dir).list()?;
    let active = agent.map(Agent::session_id);
    write_diagnostic_stderr(&format_session_list(&summaries, active))
        .context("write session list")?;
    Ok(())
}

fn apply_thinking(renderer: &ConsoleRenderer, value: Option<bool>) -> Result<()> {
    match value {
        Some(visible) => renderer.set_thinking_visible(visible),
        None => renderer.set_thinking_visible(!renderer.is_thinking_visible()),
    }
    let state = if renderer.is_thinking_visible() {
        "on"
    } else {
        "off"
    };
    write_diagnostic_stderr(&format!("thinking display: {state}"))
        .context("write thinking display status")?;
    Ok(())
}

pub(crate) fn write_banner(args: &CliArgs, settings: &GlobalConfigStore) -> Result<()> {
    let paths = resolve_project_paths(args)?;
    write_diagnostic_stderr(&format!(
        "MoonTide console\n  model  {}\n  cwd    {}\nType /help for commands. End a line with \\ for multi-line input.",
        settings.model,
        paths.cwd.display(),
    ))
    .context("write console banner")?;
    Ok(())
}

pub(crate) fn attach_console_progress(settings: &mut GlobalConfigStore) -> Arc<ConsoleRenderer> {
    let renderer = Arc::new(ConsoleRenderer::new(Arc::new(
        std::sync::atomic::AtomicBool::new(false),
    )));
    settings.host_progress = Some(Arc::clone(&renderer) as Arc<dyn agent::ProgressObserver>);
    renderer
}

pub(crate) async fn await_turn_with_ctrl_c<Turn, Signal>(
    turn: Turn,
    cancellation: CancellationToken,
    ctrl_c: Signal,
) -> Result<TurnOutcome>
where
    Turn: Future<Output = Result<ModelResponse>>,
    Signal: Future<Output = io::Result<()>>,
{
    tokio::pin!(turn);
    tokio::pin!(ctrl_c);
    tokio::select! {
        biased;
        result = &mut turn => Ok(TurnOutcome::Completed(result)),
        signal = &mut ctrl_c => match signal {
            Ok(()) => {
                cancellation.cancel();
                let _ = turn.await;
                Ok(TurnOutcome::Cancelled)
            }
            Err(error) => {
                cancellation.cancel();
                let _ = turn.await;
                Err(anyhow::Error::new(error).context("wait for Ctrl-C signal"))
            }
        },
    }
}
