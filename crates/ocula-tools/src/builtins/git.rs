use std::path::Path;

use serde_json::json;

use crate::path_util::resolve_workspace_path;

const DIFF_MAX_LINES: usize = 200;
const DIFF_OUTPUT_LIMIT: usize = 50_000;

pub async fn run_git_status(workdir: &Path) -> String {
    match git_output(workdir, &["status", "-sb"]).await {
        Ok((stdout, stderr, _)) if is_not_git_repo(&stderr) => {
            json!({ "status": "error", "error": "not a git repository" }).to_string()
        }
        Ok((stdout, _, _)) => json!({
            "status": "ok",
            "porcelain": stdout.trim()
        })
        .to_string(),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            json!({ "status": "error", "error": "git is not available on PATH" }).to_string()
        }
        Err(e) => json!({ "status": "error", "error": e.to_string() }).to_string(),
    }
}

pub async fn run_git_diff(
    workdir: &Path,
    stat: bool,
    path: Option<&str>,
    staged: bool,
) -> String {
    let mut args: Vec<String> = vec!["diff".into()];
    if staged {
        args.push("--cached".into());
    }
    if stat {
        args.push("--stat".into());
    }
    if let Some(p) = path.filter(|s| !s.trim().is_empty()) {
        match resolve_workspace_path(p, workdir) {
            Ok(resolved) => {
                args.push("--".into());
                args.push(resolved.to_string_lossy().into_owned());
            }
            Err(e) => return json!({ "status": "error", "error": e.to_string() }).to_string(),
        }
    }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    match git_output(workdir, &refs).await {
        Ok((stdout, stderr, code)) if is_not_git_repo(&stderr) => {
            json!({ "status": "error", "error": "not a git repository" }).to_string()
        }
        Ok((stdout, stderr, code)) if code != Some(0) && code != Some(1) => json!({
            "status": "error",
            "error": if stderr.trim().is_empty() { stdout.trim() } else { stderr.trim() }
        })
        .to_string(),
        Ok((stdout, _, _)) => format_diff_response(stdout, stat),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            json!({ "status": "error", "error": "git is not available on PATH" }).to_string()
        }
        Err(e) => json!({ "status": "error", "error": e.to_string() }).to_string(),
    }
}

fn format_diff_response(stdout: String, stat: bool) -> String {
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return json!({
            "status": "ok",
            "summary": "(no diff)",
            "truncated": false
        })
        .to_string();
    }

    if stat {
        return json!({
            "status": "ok",
            "summary": trimmed,
            "truncated": false
        })
        .to_string();
    }

    let lines: Vec<&str> = trimmed.lines().collect();
    let total_lines = lines.len();
    let over_line_limit = total_lines > DIFF_MAX_LINES;
    let over_byte_limit = trimmed.len() > DIFF_OUTPUT_LIMIT;

    if over_line_limit || over_byte_limit {
        let preview_lines = lines.iter().take(DIFF_MAX_LINES).copied().collect::<Vec<_>>();
        let preview = preview_lines.join("\n");
        return json!({
            "status": "ok",
            "truncated": true,
            "total_lines": total_lines,
            "lines_shown": preview_lines.len(),
            "summary": preview,
            "hint": "use git_diff with stat=true or path=... for smaller output"
        })
        .to_string();
    }

    json!({
        "status": "ok",
        "summary": trimmed,
        "truncated": false
    })
    .to_string()
}

pub async fn run_git_log(workdir: &Path, n: u32, path: Option<&str>) -> String {
    let mut args = vec![
        "log".to_string(),
        "-n".to_string(),
        n.to_string(),
        "--pretty=format:%H%x09%ad%x09%s".to_string(),
        "--date=short".to_string(),
    ];
    if let Some(p) = path.filter(|s| !s.trim().is_empty()) {
        match resolve_workspace_path(p, workdir) {
            Ok(resolved) => {
                args.push("--".into());
                args.push(resolved.to_string_lossy().into_owned());
            }
            Err(e) => return json!({ "status": "error", "error": e.to_string() }).to_string(),
        }
    }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    match git_output(workdir, &refs).await {
        Ok((stdout, stderr, code)) if is_not_git_repo(&stderr) => {
            json!({ "status": "error", "error": "not a git repository" }).to_string()
        }
        Ok((_, stderr, code)) if code != Some(0) => {
            json!({ "status": "error", "error": stderr.trim() }).to_string()
        }
        Ok((stdout, _, _)) => {
            let commits: Vec<_> = stdout
                .lines()
                .filter(|l| !l.trim().is_empty())
                .map(|line| {
                    let parts: Vec<_> = line.split('\t').collect();
                    json!({
                        "hash": parts.first().unwrap_or(&""),
                        "date": parts.get(1),
                        "subject": parts.get(2).copied().unwrap_or("")
                    })
                })
                .collect();
            json!({ "status": "ok", "commits": commits }).to_string()
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            json!({ "status": "error", "error": "git is not available on PATH" }).to_string()
        }
        Err(e) => json!({ "status": "error", "error": e.to_string() }).to_string(),
    }
}

pub fn run_git_summary_link(log_n: Option<u32>) -> String {
    let log_n = log_n.unwrap_or(5).max(1);
    json!({
        "status": "use_code_repl",
        "template": "git_summary",
        "vars": { "log_n": log_n },
        "note": "Combined git overview; use code_repl in TS harness"
    })
    .to_string()
}

async fn git_output(workdir: &Path, args: &[&str]) -> std::io::Result<(String, String, Option<i32>)> {
    let output = tokio::process::Command::new("git")
        .args(args)
        .current_dir(workdir)
        .output()
        .await?;
    Ok((
        String::from_utf8_lossy(&output.stdout).into_owned(),
        String::from_utf8_lossy(&output.stderr).into_owned(),
        output.status.code(),
    ))
}

fn is_not_git_repo(stderr: &str) -> bool {
    stderr.to_lowercase().contains("not a git repository")
}
