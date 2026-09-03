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
use globset::{
    Glob,
    GlobSetBuilder,
};
use ignore::WalkBuilder;
use serde::Deserialize;

use crate::workspace::{
    canonical_working_dir,
    expected_failure,
    relative_display_path,
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FindInput {
    pattern: String,
    #[serde(default = "default_path")]
    path: String,
    #[serde(default = "default_max_results")]
    max_results: usize,
}

fn default_path() -> String {
    ".".to_owned()
}

const fn default_max_results() -> usize {
    100
}

pub(crate) struct FindExecutor;

impl ToolExecutor for FindExecutor {
    fn execute<'a>(
        &'a self,
        call: &'a ToolCall,
        working_dir: &'a Path,
    ) -> Pin<Box<dyn Future<Output = Result<ToolResult>> + Send + 'a>> {
        Box::pin(async move {
            let input = serde_json::from_value::<FindInput>(call.input().clone())
                .context("find input no longer matches its schema")?;
            let call = call.clone();
            let working_dir = working_dir.to_path_buf();

            tokio::task::spawn_blocking(move || find_paths(&call, input, working_dir))
                .await
                .context("find blocking task failed")?
        })
    }
}

fn find_paths(call: &ToolCall, input: FindInput, working_dir: PathBuf) -> Result<ToolResult> {
    let working_dir = canonical_working_dir(&working_dir)?;
    let target = match crate::workspace::resolve_target(&working_dir, &input.path) {
        Ok(target) => target,
        Err(message) => return Ok(expected_failure(call, message)),
    };

    if !target.is_dir() {
        return Ok(expected_failure(
            call,
            format!("find path {} is not a directory", input.path),
        ));
    }

    let matcher = match build_matcher(&input.pattern) {
        Ok(matcher) => matcher,
        Err(error) => {
            return Ok(expected_failure(
                call,
                format!("invalid find glob {}: {error}", input.pattern),
            ));
        }
    };

    let mut matches = Vec::new();
    let walker = WalkBuilder::new(&target)
        .standard_filters(true)
        .require_git(false)
        .follow_links(false)
        .current_dir(&working_dir)
        .sort_by_file_path(|left, right| left.cmp(right))
        .build();

    for entry in walker {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                return Ok(expected_failure(call, format!("find walk failed: {error}")));
            }
        };
        if !entry
            .file_type()
            .is_some_and(|file_type| file_type.is_file())
        {
            continue;
        }

        let display_path = relative_display_path(entry.path(), &working_dir)?;
        if matcher.is_match(&display_path) {
            matches.push(display_path);
            if matches.len() >= input.max_results {
                break;
            }
        }
    }

    if matches.is_empty() {
        Ok(ToolResult::succeeded(
            call,
            ToolContent::Text("No files found.".to_owned()),
        ))
    } else {
        Ok(ToolResult::succeeded(
            call,
            ToolContent::Text(matches.join("\n")),
        ))
    }
}

fn build_matcher(pattern: &str) -> Result<globset::GlobSet> {
    let mut builder = GlobSetBuilder::new();
    builder.add(Glob::new(pattern)?);
    if !pattern.contains('/') {
        builder.add(Glob::new(&format!("**/{pattern}"))?);
    }
    Ok(builder.build()?)
}
