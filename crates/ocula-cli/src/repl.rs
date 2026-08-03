use anyhow::Result;
use ocula_agent::AgentSession;
use rustyline::DefaultEditor;

pub async fn run_repl(mut agent: AgentSession) -> Result<()> {
    println!("Ocula REPL (Rust). Commands: /exit, /new, /workdir");
    println!("Session: {}", agent.session.session_id);

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

        match trimmed {
            "/exit" | "/quit" => break,
            "/new" => {
                agent.reset_session();
                println!("New session: {}", agent.session.session_id);
                continue;
            }
            "/workdir" => {
                println!("{}", agent.workdir().display());
                continue;
            }
            cmd if cmd.starts_with('/') => {
                println!("Unknown command: {cmd}");
                continue;
            }
            user_prompt => match agent.run(user_prompt).await {
                Ok(result) => {
                    println!("\n{}\n", result.reply);
                    let _ = rl.add_history_entry(user_prompt);
                }
                Err(e) => eprintln!("Error: {e:#}"),
            },
        }
    }

    Ok(())
}
