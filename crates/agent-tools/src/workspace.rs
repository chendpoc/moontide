use std::path::{
    Path,
    PathBuf,
};

use agent_core::tools::{
    ToolCall,
    ToolContent,
    ToolResult,
};
use anyhow::{
    Context,
    Result,
};

pub const MAX_OUTPUT_BYTES: usize = 32 * 1024;
pub const DEFAULT_MAX_LINES: usize = 2_000;
pub const OUTPUT_LIMIT_MARKER: &str = "[truncated: output limit reached]";

pub fn canonical_working_dir(working_dir: &Path) -> Result<PathBuf> {
    std::fs::canonicalize(working_dir).with_context(|| {
        format!(
            "failed to canonicalize working directory {}",
            working_dir.display()
        )
    })
}

pub fn resolve_target(working_dir: &Path, path: &str) -> Result<PathBuf, String> {
    let working_dir = match canonical_working_dir(working_dir) {
        Ok(dir) => dir,
        Err(error) => return Err(error.to_string()),
    };

    let requested = Path::new(path);
    let requested = if requested.is_absolute() {
        requested.to_path_buf()
    } else {
        working_dir.join(requested)
    };

    let target = match std::fs::canonicalize(&requested) {
        Ok(target) => target,
        Err(error) => {
            return Err(format!("path {path} is unavailable: {error}"));
        }
    };

    if !target.starts_with(&working_dir) {
        return Err(format!("path {path} is outside the working directory"));
    }

    Ok(target)
}

pub fn relative_display_path(path: &Path, working_dir: &Path) -> Result<String> {
    let relative = path.strip_prefix(working_dir).with_context(|| {
        format!(
            "path {} escaped working directory {}",
            path.display(),
            working_dir.display()
        )
    })?;
    Ok(relative.to_string_lossy().replace('\\', "/"))
}

pub fn expected_failure(call: &ToolCall, message: impl Into<String>) -> ToolResult {
    ToolResult::failed(call, ToolContent::Text(message.into()), false)
}

pub fn utf8_prefix(value: &str, max_bytes: usize) -> &str {
    let mut end = value.len().min(max_bytes);
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    &value[..end]
}

pub fn truncate_from_start(text: String, max_lines: usize, max_bytes: usize) -> String {
    let lines: Vec<&str> = text.lines().collect();
    let mut selected = if lines.len() > max_lines {
        lines[..max_lines].join("\n")
    } else {
        text.clone()
    };

    if selected.len() > max_bytes {
        selected = utf8_prefix(&selected, max_bytes).to_owned();
        if !selected.ends_with(OUTPUT_LIMIT_MARKER) {
            selected.push_str(OUTPUT_LIMIT_MARKER);
        }
        return selected;
    }

    if lines.len() > max_lines && !selected.ends_with(OUTPUT_LIMIT_MARKER) {
        if !selected.is_empty() {
            selected.push('\n');
        }
        selected.push_str(OUTPUT_LIMIT_MARKER);
    }

    selected
}

pub fn truncate_tail(text: String, max_lines: usize, max_bytes: usize) -> String {
    let lines: Vec<&str> = text.lines().collect();
    let line_truncated = lines.len() > max_lines;
    let start = lines.len().saturating_sub(max_lines);
    let mut selected = if line_truncated {
        lines[start..].join("\n")
    } else {
        text.clone()
    };

    if selected.len() > max_bytes {
        let bytes = selected.as_bytes();
        let slice = &bytes[bytes.len().saturating_sub(max_bytes)..];
        let start_idx = slice
            .iter()
            .position(|byte| *byte == b'\n')
            .map(|idx| idx + 1)
            .unwrap_or(0);
        selected = String::from_utf8_lossy(&slice[start_idx..]).into_owned();
        if !selected.ends_with(OUTPUT_LIMIT_MARKER) {
            selected.push_str(OUTPUT_LIMIT_MARKER);
        }
        return selected;
    }

    if line_truncated && !selected.ends_with(OUTPUT_LIMIT_MARKER) {
        if !selected.is_empty() {
            selected.push('\n');
        }
        selected.push_str(OUTPUT_LIMIT_MARKER);
    }

    selected
}
