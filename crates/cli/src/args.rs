use std::path::PathBuf;

use clap::{Parser, ValueEnum};

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

    /// API key used for the provider; falls back to the project settings file.
    #[arg(long, env = "DEEPSEEK_API_KEY")]
    pub(crate) api_key: Option<String>,

    /// Session Item Log directory.
    #[arg(long)]
    pub(crate) sessions_dir: Option<PathBuf>,

    /// Agent Event Log directory.
    #[arg(long)]
    pub(crate) runs_dir: Option<PathBuf>,

    /// Model name sent to the OpenAI-compatible provider.
    #[arg(long)]
    pub(crate) model: Option<String>,

    /// OpenAI-compatible endpoint root.
    #[arg(long)]
    pub(crate) base_url: Option<String>,

    /// Approval policy for non-interactive one-shot mode and the Settings default.
    #[arg(long, value_enum)]
    pub(crate) approval_policy: Option<ApprovalPolicyArg>,

    /// Display live execution events on stderr.
    #[arg(long, value_enum)]
    pub(crate) trace: Option<TraceModeArg>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub(crate) enum ApprovalPolicyArg {
    Default,
    Always,
    AlwaysAllow,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub(crate) enum TraceModeArg {
    Off,
    Events,
    EventsThinking,
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
