use std::future::Future;
use std::path::{
    Path,
    PathBuf,
};
use std::pin::Pin;
use std::process::{
    Command,
    Output,
    Stdio,
};
use std::thread;
use std::time::Duration;

use agent_core::tools::{
    ToolCall,
    ToolContent,
    ToolExecutor,
    ToolResult,
};
use anyhow::{
    Context,
    Result,
};
use serde::Deserialize;

use crate::workspace::{
    canonical_working_dir,
    expected_failure,
    truncate_tail,
    DEFAULT_MAX_LINES,
    MAX_OUTPUT_BYTES,
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BashInput {
    command: String,
    #[serde(default)]
    timeout: Option<u64>,
}

pub(crate) struct BashExecutor;

impl ToolExecutor for BashExecutor {
    fn execute<'a>(
        &'a self,
        call: &'a ToolCall,
        working_dir: &'a Path,
    ) -> Pin<Box<dyn Future<Output = Result<ToolResult>> + Send + 'a>> {
        Box::pin(async move {
            let input = serde_json::from_value::<BashInput>(call.input().clone())
                .context("bash input no longer matches its schema")?;
            let call = call.clone();
            let working_dir = working_dir.to_path_buf();

            tokio::task::spawn_blocking(move || run_command(&call, input, working_dir))
                .await
                .context("bash blocking task failed")?
        })
    }
}

fn run_command(call: &ToolCall, input: BashInput, working_dir: PathBuf) -> Result<ToolResult> {
    let working_dir = canonical_working_dir(&working_dir)?;
    let timeout = input.timeout.map(Duration::from_secs);
    let mut command = shell_command(&input.command);
    command
        .current_dir(&working_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = if let Some(timeout) = timeout {
        let (sender, receiver) = std::sync::mpsc::channel();
        thread::spawn(move || {
            let _ = sender.send(command.output());
        });
        match receiver.recv_timeout(timeout) {
            Ok(result) => result.context("failed to execute command")?,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                return Ok(expected_failure(
                    call,
                    format!("command timed out after {} seconds", timeout.as_secs()),
                ));
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                anyhow::bail!("bash worker thread exited before returning output");
            }
        }
    } else {
        command
            .output()
            .with_context(|| format!("failed to execute command: {}", input.command))?
    };

    format_output(call, output)
}

fn format_output(call: &ToolCall, output: Output) -> Result<ToolResult> {
    let mut combined = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !combined.is_empty() && !stderr.is_empty() && !combined.ends_with('\n') {
        combined.push('\n');
    }
    combined.push_str(&stderr);

    let text = if combined.is_empty() {
        "(no output)".to_owned()
    } else {
        truncate_tail(combined, DEFAULT_MAX_LINES, MAX_OUTPUT_BYTES)
    };

    if output.status.success() {
        Ok(ToolResult::succeeded(call, ToolContent::Text(text)))
    } else {
        let message = if text == "(no output)" {
            format!(
                "Command exited with code {}",
                output.status.code().unwrap_or(-1)
            )
        } else {
            format!(
                "{text}\n\nCommand exited with code {}",
                output.status.code().unwrap_or(-1)
            )
        };
        Ok(expected_failure(call, message))
    }
}

fn shell_command(command: &str) -> Command {
    #[cfg(windows)]
    {
        let mut cmd = Command::new("cmd");
        cmd.arg("/C").arg(command);
        cmd
    }
    #[cfg(not(windows))]
    {
        let mut cmd = Command::new("sh");
        cmd.arg("-c").arg(command);
        cmd
    }
}
