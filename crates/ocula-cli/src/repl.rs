use std::sync::Arc;

use anyhow::Result;
use ocula_agent::AgentSession;
use ocula_observability::{error_line, session_line, startup_banner, ObservabilityState};
use ocula_tools::AlwaysAllowState;
use rustyline::DefaultEditor;

use crate::commands::{
    handle_always_allow_command, handle_thinking_command, handle_verbose_command, help_text,
    parse_repl_command,
};

pub async fn run_repl(
    mut agent: AgentSession,
    obs: Arc<ObservabilityState>,
    always_allow: Arc<AlwaysAllowState>,
) -> Result<()> {
    println!("{}", startup_banner());
    println!("{}", session_line(&agent.session.session_id));

    let mut rl = DefaultEditor::new()?;

    loop {
        let prompt = format!("ocula [{}]> ", agent.session.session_id);
        let line = match rl.readline(&prompt) {
            Ok(l) => l,
            Err(rustyline::error::ReadlineError::Eof)
            | Err(rustyline::error::ReadlineError::Interrupted) => break,
            Err(e) => return Err(e.into()),
        };

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        // Aliases aligned with TS REPL
        let normalized = match trimmed {
            "q" | "exit" => "/exit",
            "/reset" => "/new",
            other => other,
        };

        if let Some((cmd, arg)) = parse_repl_command(normalized) {
            match cmd {
                "exit" | "quit" => break,
                "help" => {
                    println!("{}", help_text());
                    continue;
                }
                "new" | "reset" => {
                    agent.reset_session();
                    println!("New session: {}", agent.session.session_id);
                    continue;
                }
                "workdir" => {
                    println!("{}", agent.workdir().display());
                    continue;
                }
                "thinking" => {
                    println!("{}", handle_thinking_command(&obs, arg));
                    continue;
                }
                "verbose" => {
                    println!("{}", handle_verbose_command(&obs, arg));
                    continue;
                }
                "always-allow" => {
                    println!("{}", handle_always_allow_command(&always_allow, arg));
                    continue;
                }
                _ => {
                    println!("Unknown command: /{cmd} — try /help");
                    continue;
                }
            }
        }

        match agent.run(normalized).await {
            Ok(result) => {
                println!("\n{}\n", result.reply);
                let _ = rl.add_history_entry(normalized);
            }
            Err(e) => eprintln!("{}", error_line(&format!("{e:#}"))),
        }
    }

    Ok(())
}
