use std::{
    future::Future,
    path::{Path, PathBuf},
    pin::Pin,
};

use agent_core::tools::{ToolCall, ToolContent, ToolExecutor, ToolResult};
use anyhow::{Context, Result};
use serde::Deserialize;

use crate::workspace::{canonical_working_dir, expected_failure, resolve_target};

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct EditReplacement {
    old_string: String,
    new_string: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EditInput {
    path: String,
    edits: Vec<EditReplacement>,
}

pub(crate) struct EditExecutor;

impl ToolExecutor for EditExecutor {
    fn execute<'a>(
        &'a self,
        call: &'a ToolCall,
        working_dir: &'a Path,
    ) -> Pin<Box<dyn Future<Output = Result<ToolResult>> + Send + 'a>> {
        Box::pin(async move {
            let input = serde_json::from_value::<EditInput>(call.input().clone())
                .context("edit input no longer matches its schema")?;
            let call = call.clone();
            let working_dir = working_dir.to_path_buf();

            tokio::task::spawn_blocking(move || edit_file(&call, input, working_dir))
                .await
                .context("edit blocking task failed")?
        })
    }
}

fn edit_file(call: &ToolCall, input: EditInput, working_dir: PathBuf) -> Result<ToolResult> {
    if input.edits.is_empty() {
        return Ok(expected_failure(
            call,
            "edit requires at least one replacement in edits",
        ));
    }

    let working_dir = canonical_working_dir(&working_dir)?;
    let target = match resolve_target(&working_dir, &input.path) {
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
            format!("edit target {} is not a regular file", input.path),
        ));
    }

    let original = match std::fs::read_to_string(&target) {
        Ok(content) => content,
        Err(error) => {
            return Ok(expected_failure(
                call,
                format!("failed to read {}: {error}", input.path),
            ));
        }
    };

    let updated = match apply_edits(&original, &input.edits, &input.path) {
        Ok(content) => content,
        Err(message) => return Ok(expected_failure(call, message)),
    };

    std::fs::write(&target, &updated).with_context(|| format!("failed to write {}", input.path))?;

    Ok(ToolResult::succeeded(
        call,
        ToolContent::Text(format!(
            "Successfully replaced {} block(s) in {}.",
            input.edits.len(),
            input.path
        )),
    ))
}

fn apply_edits(original: &str, edits: &[EditReplacement], path: &str) -> Result<String, String> {
    let mut ranges = Vec::with_capacity(edits.len());

    for (index, edit) in edits.iter().enumerate() {
        if edit.old_string.is_empty() {
            return Err(format!("edit {index} in {path} has an empty old_string"));
        }

        let matches: Vec<_> = original.match_indices(&edit.old_string).collect();
        match matches.len() {
            0 => {
                return Err(format!(
                    "edit {index} in {path} could not find old_string in the original file"
                ));
            }
            1 => {
                let (start, _) = matches[0];
                let end = start + edit.old_string.len();
                ranges.push((start, end, edit.new_string.as_str()));
            }
            _ => {
                return Err(format!(
                    "edit {index} in {path} matched old_string more than once; keep old_string minimal but unique"
                ));
            }
        }
    }

    ranges.sort_by_key(|(start, _, _)| *start);
    for window in ranges.windows(2) {
        let (_, left_end, _) = window[0];
        let (right_start, _, _) = window[1];
        if left_end > right_start {
            return Err(format!(
                "edits in {path} overlap; merge nearby changes into one replacement"
            ));
        }
    }

    let mut result = String::with_capacity(original.len());
    let mut cursor = 0usize;
    for (start, end, new_string) in ranges {
        result.push_str(&original[cursor..start]);
        result.push_str(new_string);
        cursor = end;
    }
    result.push_str(&original[cursor..]);
    Ok(result)
}
