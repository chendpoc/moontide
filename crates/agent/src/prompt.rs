use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
};

use agent_core::{
    model_input::SystemPrompt,
    r#loop::{ToolPermission, ToolPermissionMap},
};
use anyhow::{Context, Result};

const HARNESS_CONTRACT: &str = r#"You are running inside the MoonTide agent harness.

Runtime contract:
- A Session is an append-only Session Item Log and is the recovery source of truth.
- Each user turn may contain multiple model steps and sequential tool rounds.
- Tool permissions and approval are enforced by the harness; do not claim a tool ran unless a tool result exists.
- Expected tool failures are model-visible results. An OutcomeUnknown result means execution infrastructure could not establish the outcome.
- Cancellation stops the current turn or tool boundary; it is not evidence that a requested side effect completed.
- Agent Event Log records are derived observations and are not a replacement for Session facts.
- The host renders final assistant content as user output; diagnostics, approvals, and errors remain host-side.

Respond with the requested answer or next tool call using the capabilities listed below. Do not invent filesystem changes, tool results, or hidden context."#;

pub(crate) fn resolve(
    cwd: &Path,
    session_id: &str,
    tool_names: &[String],
    permissions: &ToolPermissionMap,
    approval_configured: bool,
) -> Result<SystemPrompt> {
    let project_instructions = load_project_instructions(cwd)?;
    let mut content = String::new();

    if !project_instructions.is_empty() {
        content.push_str("# Project Instructions\n\n");
        for (path, instructions) in project_instructions {
            content.push_str("## ");
            content.push_str(&path.display().to_string());
            content.push_str("\n\n");
            content.push_str(&instructions);
            if !instructions.ends_with('\n') {
                content.push('\n');
            }
            content.push('\n');
        }
    }

    content.push_str("# MoonTide Harness Contract\n\n");
    content.push_str(HARNESS_CONTRACT);
    content.push_str("\n\nRuntime facts:\n");
    content.push_str("- cwd: ");
    content.push_str(&cwd.display().to_string());
    content.push_str("\n- session_id: ");
    content.push_str(session_id);
    content.push_str("\n- available tools and permissions:\n");

    let names = tool_names.iter().collect::<BTreeSet<_>>();
    if names.is_empty() {
        content.push_str("  - none\n");
    } else {
        for name in names {
            let permission = permissions
                .get(name.as_str())
                .map(permission_label)
                .unwrap_or("unconfigured");
            content.push_str("  - ");
            content.push_str(name);
            content.push_str(": ");
            content.push_str(permission);
            content.push('\n');
        }
    }
    content.push_str("- approval handler: ");
    content.push_str(if approval_configured {
        "available\n"
    } else {
        "unavailable\n"
    });

    Ok(SystemPrompt::new(content))
}

pub(crate) fn validate_project_instructions(cwd: &Path) -> Result<()> {
    load_project_instructions(cwd).map(|_| ())
}

fn load_project_instructions(cwd: &Path) -> Result<Vec<(PathBuf, String)>> {
    let mut ancestors = cwd.ancestors().collect::<Vec<_>>();
    ancestors.reverse();

    let mut instructions = Vec::new();
    for directory in ancestors {
        let path = directory.join("AGENTS.md");
        if !path.exists() {
            continue;
        }
        let content = fs::read_to_string(&path)
            .with_context(|| format!("read project instructions {}", path.display()))?;
        instructions.push((path, content));
    }
    Ok(instructions)
}

fn permission_label(permission: &ToolPermission) -> &'static str {
    match permission {
        ToolPermission::Allow => "allow",
        ToolPermission::Ask => "ask",
    }
}
