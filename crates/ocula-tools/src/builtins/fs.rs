use std::fs;
use std::path::Path;

use glob::glob;

use crate::path_util::resolve_workspace_path;

pub fn run_read(workdir: &Path, file_path: &str, limit: Option<u32>, offset: u32) -> String {
    match resolve_workspace_path(file_path, workdir).and_then(|p| {
        let content = fs::read_to_string(&p)?;
        Ok(content)
    }) {
        Ok(content) => {
            let lines: Vec<&str> = content.lines().collect();
            let start = offset.saturating_sub(1) as usize;
            let end = limit.map(|l| start + l as usize);
            let slice: Vec<&str> = match end {
                Some(e) => lines.get(start..e).unwrap_or(&[]).to_vec(),
                None => lines.get(start..).unwrap_or(&[]).to_vec(),
            };
            let remaining = lines.len().saturating_sub(start + slice.len());
            let mut out = slice.join("\n");
            if limit.is_some() && remaining > 0 {
                out.push_str(&format!("\n... ({remaining} more lines)"));
            }
            out
        }
        Err(e) => format!("Error: {e}"),
    }
}

pub fn run_write(workdir: &Path, file_path: &str, content: &str) -> String {
    match resolve_workspace_path(file_path, workdir) {
        Ok(resolved) => {
            if let Some(parent) = resolved.parent() {
                if let Err(e) = fs::create_dir_all(parent) {
                    return format!("Error: {e}");
                }
            }
            match fs::write(&resolved, content) {
                Ok(()) => format!("Wrote {} bytes to {file_path}", content.len()),
                Err(e) => format!("Error: {e}"),
            }
        }
        Err(e) => format!("Error: {e}"),
    }
}

pub fn run_edit(workdir: &Path, file_path: &str, old_text: &str, new_text: &str) -> String {
    match resolve_workspace_path(file_path, workdir) {
        Ok(resolved) => match fs::read_to_string(&resolved) {
            Ok(text) => {
                if !text.contains(old_text) {
                    return format!("Error: text not found in {file_path}");
                }
                let updated = text.replacen(old_text, new_text, 1);
                match fs::write(&resolved, updated) {
                    Ok(()) => format!("Edited {file_path}"),
                    Err(e) => format!("Error: {e}"),
                }
            }
            Err(e) => format!("Error: {e}"),
        },
        Err(e) => format!("Error: {e}"),
    }
}

pub fn run_glob(workdir: &Path, pattern: &str) -> String {
    let full_pattern = workdir.join(pattern);
    let pattern_str = full_pattern.to_string_lossy();
    match glob(&pattern_str) {
        Ok(paths) => {
            let mut matches: Vec<String> = paths
                .filter_map(|p| p.ok())
                .filter_map(|p| p.strip_prefix(workdir).ok().map(|r| r.to_string_lossy().into_owned()))
                .collect();
            matches.sort();
            if matches.is_empty() {
                "(no matches)".into()
            } else {
                matches.join("\n")
            }
        }
        Err(e) => format!("Error: {e}"),
    }
}

pub fn run_list_dir(workdir: &Path, relative: &str, recursive: bool) -> String {
    match resolve_workspace_path(relative, workdir) {
        Ok(resolved) => {
            if !resolved.is_dir() {
                return format!("Error: not a directory: {relative}");
            }
            if recursive {
                list_recursive(&resolved, relative, 1)
            } else {
                list_shallow(&resolved, relative)
            }
        }
        Err(e) => format!("Error: {e}"),
    }
}

fn list_shallow(resolved: &Path, relative: &str) -> String {
    let mut entries = fs::read_dir(resolved)
        .map(|rd| {
            let mut names: Vec<_> = rd.filter_map(|e| e.ok()).collect();
            names.sort_by_key(|e| e.file_name());
            names
        })
        .unwrap_or_default();

    if entries.is_empty() {
        return "(empty)".into();
    }

    entries
        .iter()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let path = if relative == "." {
                name.clone()
            } else {
                format!("{relative}/{name}")
            };
            let kind = if entry.path().is_dir() { "dir" } else { "file" };
            Some(format!("{kind}\t{path}"))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn list_recursive(resolved: &Path, prefix: &str, depth: u32) -> String {
    const MAX: usize = 500;
    let mut lines = Vec::new();
    collect_entries(resolved, prefix, depth, &mut lines);
    if lines.is_empty() {
        "(empty)".into()
    } else if lines.len() >= MAX {
        format!(
            "{}\n... (truncated at {MAX} entries)",
            lines.join("\n")
        )
    } else {
        lines.join("\n")
    }
}

fn collect_entries(dir: &Path, prefix: &str, depth: u32, lines: &mut Vec<String>) {
    const MAX: usize = 500;
    const MAX_DEPTH: u32 = 2;
    if lines.len() >= MAX || depth > MAX_DEPTH {
        return;
    }
    let Ok(read_dir) = fs::read_dir(dir) else {
        return;
    };
    let mut names: Vec<_> = read_dir.filter_map(|e| e.ok()).collect();
    names.sort_by_key(|e| e.file_name());
    for entry in names {
        if lines.len() >= MAX {
            break;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let rel = if prefix.is_empty() || prefix == "." {
            name.clone()
        } else {
            format!("{prefix}/{name}")
        };
        let meta = entry.metadata().ok();
        if meta.as_ref().is_some_and(|m| m.is_dir()) {
            lines.push(format!("dir\t{rel}"));
            collect_entries(&entry.path(), &rel, depth + 1, lines);
        } else if meta.as_ref().is_some_and(|m| m.is_file()) {
            lines.push(format!("file\t{rel}"));
        }
    }
}
