mod repl;

use std::path::PathBuf;
use std::sync::Arc;

use anyhow::Result;
use clap::Parser;
use ocula_agent::AgentSession;
use ocula_llm::AnthropicClient;
use ocula_tools::ReplInteraction;

use crate::repl::run_repl;

#[derive(Parser, Debug)]
#[command(name = "ocula", about = "Ocula — native coding agent")]
struct Cli {
    #[arg(long, env = "OCULA_WORKDIR", default_value = ".")]
    workdir: PathBuf,
}

#[tokio::main]
async fn main() -> Result<()> {
    dotenvy::dotenv().ok();
    let cli = Cli::parse();
    let workdir = std::fs::canonicalize(&cli.workdir).unwrap_or(cli.workdir);

    let llm = Arc::new(AnthropicClient::from_env()?);
    let interaction = Arc::new(ReplInteraction);

    run_repl(AgentSession::new(workdir, llm, interaction)).await
}
