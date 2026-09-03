use std::future::Future;
use std::io::{
    BufRead,
    BufReader,
};
use std::path::{
    Path,
    PathBuf,
};
use std::pin::Pin;

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
    self,
    canonical_working_dir,
    expected_failure,
    relative_display_path,
    truncate_from_start,
    DEFAULT_MAX_LINES,
    MAX_OUTPUT_BYTES,
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ReadInput {
    path: String,
    #[serde(default)]
    offset: Option<usize>,
    #[serde(default)]
    limit: Option<usize>,
}

pub(crate) struct ReadExecutor;

impl ToolExecutor for ReadExecutor {
    fn execute<'a>(
        &'a self,
        call: &'a ToolCall,
        working_dir: &'a Path,
    ) -> Pin<Box<dyn Future<Output = Result<ToolResult>> + Send + 'a>> {
        Box::pin(async move {
            let input = serde_json::from_value::<ReadInput>(call.input().clone())
                .context("read input no longer matches its schema")?;
            let call = call.clone();
            let working_dir = working_dir.to_path_buf();

            tokio::task::spawn_blocking(move || read_file(&call, input, working_dir))
                .await
                .context("read blocking task failed")?
        })
    }
}

fn read_file(call: &ToolCall, input: ReadInput, working_dir: PathBuf) -> Result<ToolResult> {
    let working_dir = canonical_working_dir(&working_dir)?;
    let target = match workspace::resolve_target(&working_dir, &input.path) {
        Ok(target) => target,
        Err(message) => return Ok(expected_failure(call, message)),
    };

    let metadata = match std::fs::metadata(&target) {
        Ok(metadata) => metadata,
        Err(error) => {
            return Ok(expected_failure(
                call,
                format!("failed to inspect {}: {error}", input.path),
            ));
        }
    };

    if !metadata.is_file() {
        return Ok(expected_failure(
            call,
            format!("read target {} is not a regular file", input.path),
        ));
    }

    let file = match std::fs::File::open(&target) {
        Ok(file) => file,
        Err(error) => {
            return Ok(expected_failure(
                call,
                format!("failed to open {}: {error}", input.path),
            ));
        }
    };

    let display_path = relative_display_path(&target, &working_dir)?;
    let start_line = input.offset.unwrap_or(1).max(1);
    let max_lines = input.limit.unwrap_or(DEFAULT_MAX_LINES).max(1);

    let mut reader = BufReader::new(file);
    let mut line_number = 0usize;
    let mut buffer = Vec::new();
    let mut selected = String::new();

    loop {
        buffer.clear();
        let bytes_read = reader
            .read_until(b'\n', &mut buffer)
            .with_context(|| format!("failed to read {}", input.path))?;
        if bytes_read == 0 {
            break;
        }

        line_number += 1;
        if line_number < start_line {
            continue;
        }

        let mut line = buffer.clone();
        trim_line_ending(&mut line);
        if line.contains(&0) {
            return Ok(expected_failure(
                call,
                format!("read target {} appears to be a binary file", input.path),
            ));
        }

        let text = String::from_utf8_lossy(&line);
        selected.push_str(&format!("{line_number:6}|{text}\n"));

        if line_number >= start_line + max_lines - 1 {
            break;
        }
    }

    if selected.is_empty() {
        if start_line > 1 && line_number < start_line {
            return Ok(expected_failure(
                call,
                format!("offset {start_line} is beyond end of file ({line_number} lines)"),
            ));
        }
        selected = format!("{display_path} is empty.\n");
    }

    let truncated = truncate_from_start(selected, max_lines, MAX_OUTPUT_BYTES);
    Ok(ToolResult::succeeded(call, ToolContent::Text(truncated)))
}

fn trim_line_ending(line: &mut Vec<u8>) {
    if line.last() == Some(&b'\n') {
        line.pop();
    }
    if line.last() == Some(&b'\r') {
        line.pop();
    }
}
