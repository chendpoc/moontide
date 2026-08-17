use std::path::PathBuf;

use clap::Parser;

/// Command-line values before environment and path defaults are resolved.
#[derive(Debug, Clone, Parser)]
#[command(name = "moontide", version, about = "MoonTide coding agent")]
pub(crate) struct CliArgs {
    /// Resume an existing Session Item Log by id.
    #[arg(long)]
    pub(crate) session: Option<String>,

    /// Execute one user Turn and exit; without this flag the R1 shell stops at REPL dispatch.
    #[arg(long)]
    pub(crate) prompt: Option<String>,

    /// Working directory used by the Agent and Project Instructions resolver.
    #[arg(long)]
    pub(crate) cwd: Option<PathBuf>,

    /// Session Item Log directory.
    #[arg(long)]
    pub(crate) sessions_dir: Option<PathBuf>,

    /// Agent Event Log directory.
    #[arg(long)]
    pub(crate) runs_dir: Option<PathBuf>,

    /// Model name sent to the OpenAI-compatible provider.
    #[arg(long, default_value = "deepseek-chat")]
    pub(crate) model: String,

    /// OpenAI-compatible endpoint root.
    #[arg(long, default_value = "https://api.deepseek.com")]
    pub(crate) base_url: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LaunchMode {
    OneShot,
    Repl,
}

impl CliArgs {
    pub(crate) fn launch_mode(&self) -> LaunchMode {
        if self.prompt.is_some() {
            LaunchMode::OneShot
        } else {
            LaunchMode::Repl
        }
    }
}
