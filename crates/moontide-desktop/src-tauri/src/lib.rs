mod bootstrap;
pub mod protocol;
mod runtime;
mod shell;

use anyhow::{Context, Result};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() -> Result<()> {
    let runtime = bootstrap::start_runtime().context("assemble MoonTide Desktop runtime")?;
    shell::run(runtime)
}
