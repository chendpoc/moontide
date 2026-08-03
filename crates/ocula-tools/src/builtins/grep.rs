use std::path::Path;

use serde_json::json;

use crate::path_util::resolve_workspace_path;

const DEFAULT_MAX: u32 = 50;
const MAX_CAP: u32 = 200;

pub async fn run_grep(
    workdir: &Path,
    pattern: &str,
    path: Option<&str>,
    glob_filter: Option<&str>,
    max_results: Option<u32>,
    case_insensitive: bool,
) -> String {
    let pattern = pattern.trim();
    if pattern.is_empty() {
        return json!({ "status": "error", "error": "pattern is required" }).to_string();
    }

    let max = normalize_max(max_results);
    let relative = path.unwrap_or(".").trim();
    let search_path = match resolve_workspace_path(relative, workdir) {
        Ok(p) => p,
        Err(e) => return json!({ "status": "error", "error": e.to_string() }).to_string(),
    };

    let out = try_rg(
        workdir,
        pattern,
        &search_path,
        max,
        glob_filter,
        case_insensitive,
    )
    .await;
    if out.get("status") == Some(&json!("ok")) {
        return out.to_string();
    }

    try_grep(workdir, pattern, &search_path, max, case_insensitive)
        .await
        .to_string()
}

fn normalize_max(max_results: Option<u32>) -> u32 {
    max_results
        .unwrap_or(DEFAULT_MAX)
        .clamp(1, MAX_CAP)
}

async fn try_rg(
    workdir: &Path,
    pattern: &str,
    search_path: &Path,
    max: u32,
    glob_filter: Option<&str>,
    case_insensitive: bool,
) -> serde_json::Value {
    let mut cmd = tokio::process::Command::new("rg");
    cmd.arg("--json")
        .arg("--max-count")
        .arg(max.to_string())
        .current_dir(workdir);
    if case_insensitive {
        cmd.arg("-i");
    }
    if let Some(g) = glob_filter {
        cmd.arg("--glob").arg(g);
    }
    cmd.arg(pattern).arg(search_path);

    match cmd.output().await {
        Ok(output) if output.status.code().is_some_and(|c| c == 0 || c == 1) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            parse_rg_json(&stdout, max)
        }
        Ok(output) => json!({
            "status": "error",
            "error": String::from_utf8_lossy(&output.stderr).trim()
        }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            json!({ "status": "error", "error": "rg not found" })
        }
        Err(e) => json!({ "status": "error", "error": e.to_string() }),
    }
}

fn parse_rg_json(stdout: &str, max: u32) -> serde_json::Value {
    let mut matches = Vec::new();
    for line in stdout.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let Ok(parsed) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        if parsed.get("type") != Some(&json!("match")) {
            continue;
        }
        let data = &parsed["data"];
        matches.push(json!({
            "file": data["path"]["text"].as_str().unwrap_or(""),
            "line": data["line_number"].as_u64().unwrap_or(0),
            "text": data["lines"]["text"].as_str().unwrap_or("").trim_end()
        }));
        if matches.len() as u32 >= max {
            return json!({
                "status": "ok",
                "matches": matches,
                "truncated": true,
                "hint": "narrow pattern/path or lower max_results"
            });
        }
    }
    json!({
        "status": "ok",
        "matches": matches,
        "truncated": false
    })
}

async fn try_grep(
    workdir: &Path,
    pattern: &str,
    search_path: &Path,
    max: u32,
    case_insensitive: bool,
) -> serde_json::Value {
    let mut cmd = tokio::process::Command::new("grep");
    cmd.arg("-rn").current_dir(workdir);
    if case_insensitive {
        cmd.arg("-i");
    }
    cmd.arg(pattern).arg(search_path);

    match cmd.output().await {
        Ok(output) if output.status.code().is_some_and(|c| c == 0 || c == 1) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let mut matches = Vec::new();
            for line in stdout.lines() {
                if let Some((file, rest)) = line.split_once(':') {
                    if let Some((line_no, text)) = rest.split_once(':') {
                        matches.push(json!({ "file": file, "line": line_no, "text": text }));
                        if matches.len() as u32 >= max {
                            return json!({
                                "status": "ok",
                                "matches": matches,
                                "truncated": true,
                                "hint": "narrow pattern/path or lower max_results"
                            });
                        }
                    }
                }
            }
            json!({ "status": "ok", "matches": matches, "truncated": false })
        }
        Ok(output) => json!({
            "status": "error",
            "error": String::from_utf8_lossy(&output.stderr).trim()
        }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => json!({
            "status": "error",
            "error": "Neither rg nor grep is available on PATH"
        }),
        Err(e) => json!({ "status": "error", "error": e.to_string() }),
    }
}
