use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

/// Low-level append-only text file access retained for legacy recorder tests.
///
/// R2 does not assemble this writer. The R3 Agent Event Log migration will move
/// the physical writer into `agent::log`.
pub(crate) struct FileWriter {
    path: PathBuf,
}

impl FileWriter {
    pub(crate) fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("create file writer directory {}", parent.display()))?;
        }
        Ok(Self {
            path: path.to_path_buf(),
        })
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    pub(crate) fn read_lines(&self) -> Result<Vec<String>> {
        if !self.path.exists() {
            return Ok(Vec::new());
        }

        let raw = fs::read_to_string(&self.path)
            .with_context(|| format!("read file writer path {}", self.path.display()))?;
        Ok(raw.lines().map(ToOwned::to_owned).collect())
    }

    pub(crate) fn append_line(&self, line: &str) -> Result<()> {
        if line
            .as_bytes()
            .iter()
            .any(|byte| matches!(byte, b'\n' | b'\r'))
        {
            anyhow::bail!("file writer line contains a newline");
        }

        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .with_context(|| format!("open file writer path {}", self.path.display()))?;
        file.write_all(line.as_bytes())
            .with_context(|| format!("append file writer path {}", self.path.display()))?;
        file.write_all(b"\n")
            .with_context(|| format!("append newline to {}", self.path.display()))?;
        Ok(())
    }
}
