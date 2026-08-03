use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;
use serde_json::json;

pub fn artifact_path(workdir: &Path, session_id: &str, artifact_id: &str) -> PathBuf {
    workdir
        .join(".ocula")
        .join("artifacts")
        .join(session_id)
        .join(artifact_id)
}

pub fn run_read_artifact(workdir: &Path, session_id: Option<&str>, artifact_id: &str) -> String {
    let Some(session_id) = session_id.filter(|s| !s.is_empty()) else {
        return json!({
            "status": "error",
            "error": "session_id required for read_artifact"
        })
        .to_string();
    };
    let id = artifact_id.trim();
    if id.is_empty() {
        return json!({ "status": "error", "error": "artifact_id is required" }).to_string();
    }
    let path = artifact_path(workdir, session_id, id);
    match fs::read_to_string(&path) {
        Ok(content) => json!({
            "status": "ok",
            "artifact_id": id,
            "byte_count": content.len(),
            "content": content
        })
        .to_string(),
        Err(e) => json!({ "status": "error", "error": e.to_string() }).to_string(),
    }
}

pub fn run_record_tool_hint(
    workdir: &Path,
    tool_name: &str,
    problem: &str,
    better_approach: &str,
    example: Option<&str>,
    tags: Option<&str>,
) -> String {
    let tool_name = tool_name.trim();
    if tool_name.is_empty() || problem.trim().is_empty() || better_approach.trim().is_empty() {
        return json!({
            "status": "error",
            "error": "tool_name, problem, and better_approach are required"
        })
        .to_string();
    }

    let slug: String = problem
        .chars()
        .filter(|c| c.is_alphanumeric())
        .take(40)
        .collect::<String>()
        .to_lowercase();
    let slug = if slug.is_empty() { "hint".into() } else { slug };
    let date = Utc::now().format("%Y-%m-%d");
    let dir = workdir.join("docs/notes/tool-hints");
    if let Err(e) = fs::create_dir_all(&dir) {
        return json!({ "status": "error", "error": e.to_string() }).to_string();
    }
    let filename = format!("{date}-{tool_name}-{slug}.md");
    let path = dir.join(&filename);

    let mut body = format!(
        "# Tool hint: {tool_name}\n\n\
         ## Problem\n{problem}\n\n\
         ## Better approach\n{better_approach}\n"
    );
    if let Some(ex) = example.filter(|s| !s.trim().is_empty()) {
        body.push_str(&format!("\n## Example\n{ex}\n"));
    }
    if let Some(t) = tags.filter(|s| !s.trim().is_empty()) {
        body.push_str(&format!("\n## Tags\n{t}\n"));
    }
    body.push_str("\n## Follow-up\nReview and upstream via PR.\n");

    match fs::write(&path, body) {
        Ok(()) => {
            let rel = path
                .strip_prefix(workdir)
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_else(|_| path.display().to_string());
            json!({
                "status": "ok",
                "path": rel,
                "message": "tool hint recorded"
            })
            .to_string()
        }
        Err(e) => json!({ "status": "error", "error": e.to_string() }).to_string(),
    }
}

pub fn dev_tool_learning_enabled() -> bool {
    std::env::var("OCULA_DEV_TOOL_LEARNING")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}
