mod bootstrap;
mod protocol_client;
mod shell;
mod transport;

use anyhow::{Context, Result};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() -> Result<()> {
    let runtime = tauri::async_runtime::block_on(bootstrap::start_runtime())
        .context("assemble MoonTide Desktop runtime")?;
    shell::run(runtime)
}
