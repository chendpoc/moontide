use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use tempfile::NamedTempFile;

/// Project-local paths shared by CLI and future frontend hosts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectPaths {
    pub cwd: PathBuf,
    pub sessions_dir: PathBuf,
    pub runs_dir: PathBuf,
    pub settings_path: PathBuf,
}

impl ProjectPaths {
    /// Resolves project-local paths without creating storage directories or resolving symlinks.
    pub fn resolve(
        cwd: PathBuf,
        sessions_dir: Option<PathBuf>,
        runs_dir: Option<PathBuf>,
    ) -> Result<Self> {
        let cwd = absolute_path(cwd).context("resolve project working directory")?;
        if !cwd.is_dir() {
            anyhow::bail!("working directory is not a directory: {}", cwd.display());
        }

        let project_dir = cwd.join(".moontide");
        let sessions_dir =
            resolve_override(&cwd, sessions_dir).unwrap_or_else(|| project_dir.join("sessions"));
        let runs_dir = resolve_override(&cwd, runs_dir).unwrap_or_else(|| project_dir.join("runs"));

        Ok(Self {
            cwd,
            sessions_dir,
            runs_dir,
            settings_path: project_dir.join("settings.json"),
        })
    }
}

/// Replaces a settings file after writing complete bytes to a same-directory temporary file.
pub fn write_settings_atomically(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)
        .with_context(|| format!("create settings directory {}", parent.display()))?;

    let mut temporary = NamedTempFile::new_in(parent)
        .with_context(|| format!("create temporary settings file in {}", parent.display()))?;
    temporary
        .write_all(bytes)
        .with_context(|| format!("write temporary settings file in {}", parent.display()))?;
    temporary
        .as_file()
        .sync_all()
        .with_context(|| format!("flush temporary settings file in {}", parent.display()))?;
    temporary
        .persist(path)
        .map_err(|error| error.error)
        .with_context(|| format!("replace settings file {}", path.display()))?;
    Ok(())
}

fn absolute_path(path: PathBuf) -> Result<PathBuf> {
    if path.is_absolute() {
        return Ok(path);
    }
    Ok(std::env::current_dir()?.join(path))
}

fn resolve_override(cwd: &Path, path: Option<PathBuf>) -> Option<PathBuf> {
    path.map(|path| {
        if path.is_absolute() {
            path
        } else {
            cwd.join(path)
        }
    })
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::*;

    // Scenario: a valid project directory has no explicit storage overrides.
    // Expected: all project-local defaults are derived under .moontide.
    // Invariant: path construction uses PathBuf semantics and creates no directories.
    #[test]
    fn resolves_default_project_paths() {
        let root = tempdir().expect("temporary project directory");
        let paths = ProjectPaths::resolve(root.path().to_owned(), None, None)
            .expect("project paths should resolve");

        assert_eq!(paths.cwd, root.path());
        assert_eq!(paths.sessions_dir, root.path().join(".moontide/sessions"));
        assert_eq!(paths.runs_dir, root.path().join(".moontide/runs"));
        assert_eq!(
            paths.settings_path,
            root.path().join(".moontide/settings.json")
        );
        assert!(!root.path().join(".moontide").exists());
    }

    // Scenario: relative and absolute storage overrides are supplied for a valid project.
    // Expected: relative values resolve against cwd while absolute values remain unchanged.
    // Invariant: an explicit absolute path is never relocated under the project directory.
    #[test]
    fn resolves_storage_overrides_against_cwd() {
        let root = tempdir().expect("temporary project directory");
        let absolute_runs = root.path().join("external-runs");
        let paths = ProjectPaths::resolve(
            root.path().to_owned(),
            Some(PathBuf::from("custom-sessions")),
            Some(absolute_runs.clone()),
        )
        .expect("overridden project paths should resolve");

        assert_eq!(paths.sessions_dir, root.path().join("custom-sessions"));
        assert_eq!(paths.runs_dir, absolute_runs);
    }

    // Scenario: the requested working directory does not exist.
    // Expected: path resolution fails before any storage directory is created.
    // Invariant: invalid project roots cannot silently create a new workspace.
    #[test]
    fn rejects_missing_working_directory() {
        let root = tempdir().expect("temporary project directory");
        let missing = root.path().join("missing");

        assert!(ProjectPaths::resolve(missing, None, None).is_err());
    }

    // Scenario: settings bytes are written twice to one project-local target.
    // Expected: each completed write replaces the previous complete JSON payload.
    // Invariant: the target is never exposed as a partially written file.
    #[test]
    fn atomically_replaces_settings_bytes() {
        let root = tempdir().expect("temporary settings directory");
        let path = root.path().join(".moontide/settings.json");

        write_settings_atomically(&path, br#"{"version":1,"model":"one"}"#)
            .expect("initial settings write should succeed");
        assert_eq!(
            fs::read(&path).expect("read initial settings"),
            br#"{"version":1,"model":"one"}"#
        );

        write_settings_atomically(&path, br#"{"version":1,"model":"two"}"#)
            .expect("replacement settings write should succeed");
        assert_eq!(
            fs::read(&path).expect("read replacement settings"),
            br#"{"version":1,"model":"two"}"#
        );
    }

    // Scenario: the settings target is an existing directory rather than a file.
    // Expected: replacement fails without deleting the directory.
    // Invariant: a failed settings write does not destructively remove the existing target.
    #[test]
    fn failed_replacement_preserves_existing_target() {
        let root = tempdir().expect("temporary settings directory");
        let target = root.path().join("settings.json");
        fs::create_dir(&target).expect("settings target directory");

        assert!(write_settings_atomically(&target, b"{} ").is_err());
        assert!(target.is_dir());
    }
}
