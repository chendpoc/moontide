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

use std::process::ExitCode;

use agent::Agent;
use anyhow::{bail, Result};
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
            let cancellation = CancellationToken::new();
            match await_turn_with_ctrl_c(
                agent.turn(prompt, cancellation.clone()),
                cancellation,
                tokio::signal::ctrl_c(),
            )
            .await?
            {
                TurnOutcome::Completed(result) => {
                    let response = result?;
                    write_assistant_stdout(&response, std::io::stdout().lock())?;
                    Ok(())
                }
                TurnOutcome::Cancelled => bail!("cancelled"),
            }
        }
        (LaunchMode::Repl, None) => {
            let mut runtime_settings = settings;
            run_repl(
                &mut agent,
                input_owner.ok_or_else(|| anyhow::anyhow!("interactive input owner missing"))?,
                &args,
                &mut runtime_settings,
            )
            .await
        }
        _ => bail!("invalid CLI launch state"),
    }
}
