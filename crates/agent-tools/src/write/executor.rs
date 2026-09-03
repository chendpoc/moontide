use std::future::Future;
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
    canonical_working_dir,
    expected_failure,
    resolve_target,
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WriteInput {
    path: String,
    content: String,
}

pub(crate) struct WriteExecutor;

impl ToolExecutor for WriteExecutor {
    fn execute<'a>(
        &'a self,
        call: &'a ToolCall,
        working_dir: &'a Path,
    ) -> Pin<Box<dyn Future<Output = Result<ToolResult>> + Send + 'a>> {
        Box::pin(async move {
            let input = serde_json::from_value::<WriteInput>(call.input().clone())
                .context("write input no longer matches its schema")?;
            let call = call.clone();
            let working_dir = working_dir.to_path_buf();

            tokio::task::spawn_blocking(move || write_file(&call, input, working_dir))
                .await
                .context("write blocking task failed")?
        })
    }
}

fn write_file(call: &ToolCall, input: WriteInput, working_dir: PathBuf) -> Result<ToolResult> {
    let working_dir = canonical_working_dir(&working_dir)?;
    let target = match resolve_write_target(&working_dir, &input.path) {
        Ok(target) => target,
        Err(message) => return Ok(expected_failure(call, message)),
    };

    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create parent directories for {}", input.path))?;
    }

    std::fs::write(&target, &input.content)
        .with_context(|| format!("failed to write {}", input.path))?;

    Ok(ToolResult::succeeded(
        call,
        ToolContent::Text(format!(
            "Successfully wrote {} bytes to {}.",
            input.content.len(),
            input.path
        )),
    ))
}

fn resolve_write_target(working_dir: &Path, path: &str) -> Result<PathBuf, String> {
    if Path::new(path).exists() || working_dir.join(path).exists() {
        return resolve_target(working_dir, path);
    }

    let mut target = working_dir.to_path_buf();
    for component in Path::new(path).components() {
        match component {
            std::path::Component::Normal(part) => target.push(part),
            std::path::Component::ParentDir => {
                target.pop();
            }
            std::path::Component::CurDir => {}
            std::path::Component::RootDir | std::path::Component::Prefix(_) => {
                if Path::new(path).is_absolute() {
                    target = PathBuf::from(path);
                    break;
                }
                return Err(format!("path {path} is invalid"));
            }
        }
    }

    if !target.starts_with(working_dir) {
        return Err(format!("path {path} is outside the working directory"));
    }

    Ok(target)
}
