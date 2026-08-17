use agent::Agent;
use anyhow::{Context, Result};
use rustyline::{error::ReadlineError, DefaultEditor};
use tokio_util::sync::CancellationToken;

use crate::render::{write_assistant_stdout, write_diagnostic_stderr};

const PROMPT: &str = "moontide> ";
const HELP: &str = "/id  show session id\n/help  show this help\n/exit  exit the REPL";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ReplCommand {
    Exit,
    Help,
    SessionId,
    Turn(String),
}

pub(crate) fn parse_command(line: String) -> ReplCommand {
    match line.trim() {
        "/exit" => ReplCommand::Exit,
        "/help" => ReplCommand::Help,
        "/id" => ReplCommand::SessionId,
        _ => ReplCommand::Turn(line),
    }
}

pub(crate) async fn run(agent: &mut Agent) -> Result<()> {
    let mut editor = DefaultEditor::new().map_err(anyhow::Error::new)?;
    loop {
        match editor.readline(PROMPT) {
            Ok(line) => {
                if !line.trim().is_empty() {
                    editor
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
                    ReplCommand::Turn(text) => {
                        let cancellation = CancellationToken::new();
                        match agent.turn(text, cancellation).await {
                            Ok(response) => {
                                write_assistant_stdout(&response, std::io::stdout().lock())
                                    .context("write REPL assistant output")?;
                            }
                            Err(error) => {
                                write_diagnostic_stderr(&format!("ERROR: {error:#}"))
                                    .context("write REPL turn error")?;
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
