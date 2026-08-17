use std::{
    future::Future,
    io::{self, Write},
    pin::Pin,
};

use agent::{ToolApproval, ToolApprovalHandler, ToolCall};
use anyhow::{Context, Result};

const MAX_INPUT_PREVIEW_CHARS: usize = 512;

/// Interactive approval boundary for the terminal shell.
pub(crate) struct InteractiveApproval;

impl ToolApprovalHandler for InteractiveApproval {
    fn request<'a>(
        &'a self,
        call: &'a ToolCall,
    ) -> Pin<Box<dyn Future<Output = Result<ToolApproval>> + Send + 'a>> {
        let name = call.name().to_owned();
        let input =
            serde_json::to_string(call.input()).context("serialize tool input for approval prompt");
        Box::pin(async move {
            let input = input?;
            tokio::task::spawn_blocking(move || prompt_and_read(&name, &input))
                .await
                .context("join interactive approval task")?
        })
    }
}

fn prompt_and_read(name: &str, input: &str) -> Result<ToolApproval> {
    let summary = truncate_preview(input);
    let mut stderr = io::stderr().lock();
    write!(stderr, "Approve tool `{name}` with input {summary}? [y/N] ")?;
    stderr.flush()?;
    drop(stderr);

    let mut line = String::new();
    let bytes_read = io::stdin().read_line(&mut line)?;
    if bytes_read == 0 {
        return Ok(ToolApproval::Cancelled);
    }
    Ok(parse_response(&line))
}

pub(crate) fn parse_response(input: &str) -> ToolApproval {
    match input.trim().to_ascii_lowercase().as_str() {
        "y" | "yes" => ToolApproval::Approved,
        "" | "n" | "no" => ToolApproval::Denied {
            reason: "tool approval denied by user".into(),
        },
        _ => ToolApproval::Denied {
            reason: "approval response must be y or n".into(),
        },
    }
}

pub(crate) fn truncate_preview(input: &str) -> String {
    let mut chars = input.chars();
    let preview = chars
        .by_ref()
        .take(MAX_INPUT_PREVIEW_CHARS)
        .collect::<String>();
    if chars.next().is_some() {
        format!("{preview}…")
    } else {
        preview
    }
}
