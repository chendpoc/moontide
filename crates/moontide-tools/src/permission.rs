use std::path::Path;

use crate::names;
use crate::path_util::is_outside_workspace;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    Allow,
    Deny,
    Ask,
}

const SYSTEM_DENY: &[&str] = &["rm -rf /", "sudo", "shutdown", "reboot", "mkfs", "dd if="];
const DESTRUCTIVE_ASK: &[&str] = &["rm ", "> /etc/", "chmod 777"];

pub fn check_permission(
    tool_name: &str,
    input: &serde_json::Value,
    workdir: &Path,
) -> Decision {
    match tool_name {
        names::BASH => check_bash(input.get("command").and_then(|v| v.as_str()).unwrap_or("")),
        names::READ_FILE | names::WRITE_FILE | names::EDIT_FILE => {
            let path = input.get("path").and_then(|v| v.as_str()).unwrap_or("");
            check_workspace_path(path, workdir)
        }
        _ => Decision::Allow,
    }
}

fn check_bash(command: &str) -> Decision {
    if SYSTEM_DENY.iter().any(|p| command.contains(p)) {
        return Decision::Deny;
    }
    if DESTRUCTIVE_ASK.iter().any(|p| command.contains(p)) {
        return Decision::Ask;
    }
    if regex::Regex::new(r"(?i)\bcurl\b").unwrap().is_match(command)
        || regex::Regex::new(r"(?i)\bwget\b").unwrap().is_match(command)
    {
        return Decision::Ask;
    }
    if regex::Regex::new(r"\brg\b").unwrap().is_match(command)
        || regex::Regex::new(r"\bgrep\b").unwrap().is_match(command)
    {
        return Decision::Ask;
    }
    if regex::Regex::new(r"(?i)\bgit\s+(status|diff|log)\b")
        .unwrap()
        .is_match(command)
    {
        return Decision::Ask;
    }
    Decision::Allow
}

fn check_workspace_path(path: &str, workdir: &Path) -> Decision {
    if path.is_empty() || !is_outside_workspace(path, workdir) {
        Decision::Allow
    } else {
        Decision::Ask
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn denies_sudo() {
        assert_eq!(
            check_permission(
                names::BASH,
                &serde_json::json!({ "command": "sudo rm -rf /" }),
                Path::new("/tmp")
            ),
            Decision::Deny
        );
    }

    #[test]
    fn allows_read_inside_workdir() {
        let dir = tempdir().unwrap();
        assert_eq!(
            check_permission(
                names::READ_FILE,
                &serde_json::json!({ "path": "a.txt" }),
                dir.path()
            ),
            Decision::Allow
        );
    }
}
