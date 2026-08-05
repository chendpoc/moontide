use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

use crate::ids::new_event_id;
use crate::paths::artifact_path;

#[derive(Debug, Clone)]
pub struct ArtifactStore {
    workdir: PathBuf,
}

impl ArtifactStore {
    pub fn new(workdir: impl Into<PathBuf>) -> Self {
        Self {
            workdir: workdir.into(),
        }
    }

    pub fn put(
        &self,
        session_id: &str,
        tool_use_id: &str,
        content: &str,
    ) -> Result<String> {
        let artifact_id = format!("art_{}", new_event_id());
        let path = artifact_path(&self.workdir, session_id, &artifact_id);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("create artifact dir {}", parent.display()))?;
        }
        fs::write(&path, content)
            .with_context(|| format!("write artifact {}", path.display()))?;
        let _ = tool_use_id; // reserved for future metadata sidecar
        Ok(artifact_id)
    }

    pub fn get(&self, session_id: &str, artifact_id: &str) -> Result<String> {
        let path = artifact_path(&self.workdir, session_id, artifact_id);
        fs::read_to_string(&path).with_context(|| format!("read artifact {}", path.display()))
    }

    pub fn path(&self, session_id: &str, artifact_id: &str) -> PathBuf {
        artifact_path(&self.workdir, session_id, artifact_id)
    }

    pub fn workdir(&self) -> &Path {
        &self.workdir
    }
}
