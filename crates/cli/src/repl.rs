use std::{future::Future, io};

use agent::{Agent, ModelResponse};
use anyhow::{Context, Result};
use rustyline::error::ReadlineError;
use tokio_util::sync::CancellationToken;

use crate::args::CliArgs;
use crate::input::InputOwner;
use crate::render::{write_assistant_stdout, write_diagnostic_stderr};
use crate::settings::RuntimeSettings;
use crate::settings_ui::run_settings_ui;

const PROMPT: &str = "moontide> ";
const HELP: &str = "/id       show session id\n/settings  open settings overlay\n/help      show this help\n/exit      exit the REPL";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ReplCommand {
    Exit,
    Help,
    SessionId,
    Settings,
    Turn(String),
}

pub(crate) enum TurnOutcome {
    Completed(Result<ModelResponse>),
    Cancelled,
}

pub(crate) fn parse_command(line: String) -> ReplCommand {
    match line.trim() {
        "/exit" => ReplCommand::Exit,
        "/help" => ReplCommand::Help,
        "/id" => ReplCommand::SessionId,
        "/settings" => ReplCommand::Settings,
        _ => ReplCommand::Turn(line),
    }
}

pub(crate) async fn run(
    agent: &mut Agent,
    input_owner: InputOwner,
    args: &CliArgs,
    settings: &mut RuntimeSettings,
) -> Result<()> {
    loop {
        match input_owner.readline(PROMPT) {
            Ok(line) => {
                if !line.trim().is_empty() {
                    input_owner
                        .add_history_entry(line.as_str())
                        .map_err(anyhow::Error::new)?;
                }
                match parse_command(line) {
                    ReplCommand::Exit => return Ok(()),
                    ReplCommand::Help => {
                        write_diagnostic_stderr(HELP).context("write REPL help")?;
                    }
                    ReplCommand::SessionId => {
                        write_diagnostic_stderr(&format!("session id: {}", agent.session_id()))
                            .context("write REPL session id")?;
                    }
                    ReplCommand::Settings => {
                        settings.input_owner = Some(input_owner.clone());
                        tokio::task::block_in_place(|| run_settings_ui(settings, agent, args))?;
                    }
                    ReplCommand::Turn(text) => {
                        let cancellation = CancellationToken::new();
                        let outcome = await_turn_with_ctrl_c(
                            agent.turn(text, cancellation.clone()),
                            cancellation,
                            tokio::signal::ctrl_c(),
                        )
                        .await?;
                        match outcome {
                            TurnOutcome::Completed(Ok(response)) => {
                                write_assistant_stdout(&response, std::io::stdout().lock())
                                    .context("write REPL assistant output")?;
                            }
                            TurnOutcome::Completed(Err(error)) => {
                                write_diagnostic_stderr(&format!("ERROR: {error:#}"))
                                    .context("write REPL turn error")?;
                            }
                            TurnOutcome::Cancelled => {
                                write_diagnostic_stderr("cancelled")
                                    .context("write REPL cancellation")?;
                            }
                        }
                    }
                }
            }
            Err(ReadlineError::Interrupted) => {
                write_diagnostic_stderr("cancelled").context("write REPL interruption")?;
            }
            Err(ReadlineError::Eof) => return Ok(()),
            Err(error) => return Err(anyhow::Error::new(error).context("read REPL input")),
        }
    }
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
