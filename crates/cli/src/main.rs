mod args;
mod config;
mod render;

use std::process::ExitCode;

use agent::Agent;
use anyhow::{bail, Result};
use args::{CliArgs, LaunchMode};
use clap::Parser;
use config::{resolve_agent_config, session_mode, validate_prompt};
use render::write_assistant_stdout;
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
    let config = resolve_agent_config(&args)?;
    let mut agent = match args.session.as_deref() {
        Some(session_id) => Agent::resume(config, session_id)?,
        None => Agent::create(config)?,
    };
    let _ = render::write_diagnostic_stderr(&format!(
        "session ({}) id: {}",
        session_mode(&args),
        agent.session_id()
    ));

    match (args.launch_mode(), prompt) {
        (LaunchMode::OneShot, Some(prompt)) => {
            let response = agent.turn(prompt, CancellationToken::new()).await?;
            write_assistant_stdout(&response, std::io::stdout().lock())?;
            Ok(())
        }
        (LaunchMode::Repl, None) => {
            bail!("REPL is not implemented in CLI R1; pass --prompt for one-shot mode")
        }
        _ => bail!("invalid CLI launch state"),
    }
}
