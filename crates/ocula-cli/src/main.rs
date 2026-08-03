mod commands;
mod repl;

use std::path::PathBuf;
use std::sync::Arc;

use anyhow::Result;
use clap::Parser;
use ocula_agent::AgentSession;
use ocula_llm::AnthropicClient;
use ocula_observability::ObservabilityState;
use ocula_tools::{AlwaysAllowState, ReplInteraction};

use crate::repl::run_repl;

#[derive(Parser, Debug)]
#[command(name = "ocula", about = "Ocula — native coding agent")]
struct Cli {
    #[arg(long, env = "OCULA_WORKDIR", default_value = ".")]
    workdir: PathBuf,

    /// Auto-approve ask-class tools without prompting (also OCULA_ALWAYS_ALLOW=1).
    #[arg(long)]
    always_allow: bool,
}

#[tokio::main]
async fn main() -> Result<()> {
    dotenvy::dotenv().ok();
    let cli = Cli::parse();
    let workdir = std::fs::canonicalize(&cli.workdir).unwrap_or(cli.workdir);

    let obs = Arc::new(ObservabilityState::from_env());
    let always_allow = Arc::new(AlwaysAllowState::from_env());
    if cli.always_allow {
        always_allow.set_override(Some(true));
    }

    let llm = Arc::new(AnthropicClient::from_env()?);
    let interaction = Arc::new(ReplInteraction::new(always_allow.clone()));

    let agent = AgentSession::new(workdir, llm, interaction, obs.clone());
    run_repl(agent, obs, always_allow).await
}
