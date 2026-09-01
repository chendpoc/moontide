mod bootstrap;
pub mod protocol;
mod runtime;
mod shell;

use anyhow::{Context, Result};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() -> Result<()> {
    shell::run().context("run MoonTide Desktop shell")
}
