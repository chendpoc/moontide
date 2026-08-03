use std::path::{Component, Path, PathBuf};

pub fn resolve_path(workdir: &Path, file_path: &str) -> PathBuf {
    let path = Path::new(file_path);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        workdir.join(path)
    }
}

pub fn is_outside_workspace(file_path: &str, workdir: &Path) -> bool {
    if file_path.is_empty() {
        return false;
    }
    let resolved = resolve_path(workdir, file_path);
    let Ok(rel) = resolved.strip_prefix(workdir) else {
        return true;
    };
    rel.components()
        .any(|component| matches!(component, Component::ParentDir))
}

pub fn resolve_workspace_path(relative: &str, workdir: &Path) -> anyhow::Result<PathBuf> {
    if is_outside_workspace(relative, workdir) {
        anyhow::bail!("Path escapes workspace: {relative}");
    }
    Ok(resolve_path(workdir, relative))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn rejects_escape() {
        let dir = tempdir().unwrap();
        assert!(is_outside_workspace("../etc/passwd", dir.path()));
    }

    #[test]
    fn allows_inside() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("a.txt"), "x").unwrap();
        assert!(!is_outside_workspace("a.txt", dir.path()));
    }
}
