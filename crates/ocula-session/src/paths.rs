use std::path::{Path, PathBuf};

pub fn data_dir(workdir: impl AsRef<Path>) -> PathBuf {
    workdir.as_ref().join(super::DATA_DIR)
}

pub fn sessions_dir(workdir: impl AsRef<Path>) -> PathBuf {
    data_dir(workdir).join(super::SESSIONS_DIR)
}

pub fn session_log_path(workdir: impl AsRef<Path>, session_id: &str) -> PathBuf {
    sessions_dir(workdir).join(format!("{session_id}.jsonl"))
}
