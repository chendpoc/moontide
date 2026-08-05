use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use tokio::process::Command;

pub async fn run_bash(workdir: &Path, command: &str) -> String {
    let result = tokio::time::timeout(
        Duration::from_secs(120),
        Command::new("/bin/bash")
            .arg("-lc")
            .arg(command)
            .current_dir(workdir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output(),
    )
    .await;

    match result {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let combined = format!("{stdout}{stderr}").trim().to_string();
            if combined.is_empty() {
                "(no output)".into()
            } else {
                combined.chars().take(50_000).collect()
            }
        }
        Ok(Err(e)) => format!("Error: {e}"),
        Err(_) => "Error: timeout (120s)".into(),
    }
}
