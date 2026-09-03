use std::future::Future;
use std::pin::Pin;

use agent::{
    ToolApproval,
    ToolApprovalHandler,
    ToolCall,
};
use anyhow::{
    Context,
    Result,
};

use crate::input::InputOwner;

const MAX_INPUT_PREVIEW_CHARS: usize = 512;

/// Interactive approval boundary for the terminal shell.
pub(crate) struct InteractiveApproval {
    input: InputOwner,
}

impl InteractiveApproval {
    pub(crate) fn new(input: InputOwner) -> Self {
        Self { input }
    }
}

impl ToolApprovalHandler for InteractiveApproval {
    fn request<'a>(
        &'a self,
        call: &'a ToolCall,
    ) -> Pin<Box<dyn Future<Output = Result<ToolApproval>> + Send + 'a>> {
        let input_owner = self.input.clone();
        let name = call.name().to_owned();
        let input =
            serde_json::to_string(call.input()).context("serialize tool input for approval prompt");
        Box::pin(async move {
            let input = input?;
            tokio::task::spawn_blocking(move || prompt_and_read(&input_owner, &name, &input))
                .await
                .context("join interactive approval task")?
        })
    }
}

/// Non-interactive approval fails closed so one-shot mode never waits on stdin.
pub(crate) struct NonInteractiveApproval;

impl ToolApprovalHandler for NonInteractiveApproval {
    fn request<'a>(
        &'a self,
        call: &'a ToolCall,
    ) -> Pin<Box<dyn Future<Output = Result<ToolApproval>> + Send + 'a>> {
        Box::pin(async move {
            Ok(ToolApproval::Denied {
                reason: format!(
                    "interactive approval is unavailable for one-shot tool {}",
                    call.name()
                ),
            })
        })
    }
}

fn prompt_and_read(input_owner: &InputOwner, name: &str, input: &str) -> Result<ToolApproval> {
    let summary = truncate_preview(input);
    eprintln!("Approve tool `{name}` with input {summary}? [y/N]");
    match input_owner.readline("") {
        Ok(line) => Ok(parse_response(&line)),
        Err(rustyline::error::ReadlineError::Eof)
        | Err(rustyline::error::ReadlineError::Interrupted) => Ok(ToolApproval::Cancelled),
        Err(error) => Err(anyhow::Error::new(error).context("read approval response")),
    }
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
