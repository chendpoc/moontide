use std::io::{self, Write};

use agent::Agent;
use anyhow::{Context, Result};
use crossterm::{
    cursor::{Hide, MoveTo, Show},
    event::{self, Event, KeyCode, KeyEvent, KeyModifiers},
    queue,
    style::{Attribute, Print, ResetColor, SetAttribute},
    terminal::{
        disable_raw_mode, enable_raw_mode, size, Clear, ClearType, EnterAlternateScreen,
        LeaveAlternateScreen,
    },
};

use crate::{
    args::CliArgs,
    setting_catalog::{
        apply_setting_change, apply_status_message, SettingApplyEffect, SettingCatalog,
    },
    settings::RuntimeSettings,
};

const HINT: &str = "Type to search · ↑↓ select · Enter/Space change · Esc cancel";

pub(crate) fn run_settings_ui(
    settings: &mut RuntimeSettings,
    agent: &mut Agent,
    args: &CliArgs,
) -> Result<()> {
    let mut catalog = SettingCatalog::from_runtime(settings, agent);
    let mut filter = String::new();
    let mut selected = 0usize;

    enable_raw_mode().context("enable settings raw mode")?;
    let mut stdout = io::stdout();
    if let Err(error) = queue!(stdout, EnterAlternateScreen, Hide)
        .and_then(|_| stdout.flush())
        .context("enter settings screen")
    {
        disable_raw_mode().ok();
        return Err(error);
    }

    let result = settings_loop(
        &mut stdout,
        &mut catalog,
        settings,
        agent,
        args,
        &mut filter,
        &mut selected,
    );

    let restore_result = queue!(stdout, Show, LeaveAlternateScreen)
        .and_then(|_| stdout.flush())
        .context("leave settings screen");
    let raw_mode_result = disable_raw_mode().context("disable settings raw mode");

    result?;
    restore_result?;
    raw_mode_result
}

fn settings_loop(
    stdout: &mut impl Write,
    catalog: &mut SettingCatalog,
    settings: &mut RuntimeSettings,
    agent: &mut Agent,
    args: &CliArgs,
    filter: &mut String,
    selected: &mut usize,
) -> Result<()> {
    loop {
        let filtered = catalog.filter_indices(filter);
        if filtered.is_empty() {
            *selected = 0;
        } else if *selected >= filtered.len() {
            *selected = filtered.len() - 1;
        }

        render_screen(stdout, catalog, filter, &filtered, *selected)?;

        if !event::poll(std::time::Duration::from_millis(100)).context("poll settings input")? {
            continue;
        }

        match event::read().context("read settings input")? {
            Event::Key(key) => {
                let mut ctx = SettingsKeyCtx {
                    catalog,
                    settings,
                    agent,
                    args,
                    filter,
                    selected,
                    filtered: &filtered,
                    stdout,
                };
                if handle_key(key, &mut ctx)? {
                    return Ok(());
                }
            }
            Event::Resize(_, _) => {}
            _ => {}
        }
    }
}

struct SettingsKeyCtx<'a, W: Write> {
    catalog: &'a mut SettingCatalog,
    settings: &'a mut RuntimeSettings,
    agent: &'a mut Agent,
    args: &'a CliArgs,
    filter: &'a mut String,
    selected: &'a mut usize,
    filtered: &'a [usize],
    stdout: &'a mut W,
}

fn handle_key<W: Write>(key: KeyEvent, ctx: &mut SettingsKeyCtx<'_, W>) -> Result<bool> {
    match key.code {
        KeyCode::Esc => return Ok(true),
        KeyCode::Up => {
            if !ctx.filtered.is_empty() && *ctx.selected > 0 {
                *ctx.selected -= 1;
            }
        }
        KeyCode::Down => {
            if !ctx.filtered.is_empty() && *ctx.selected + 1 < ctx.filtered.len() {
                *ctx.selected += 1;
            }
        }
        KeyCode::Enter | KeyCode::Char(' ') => {
            if ctx.filtered.is_empty() {
                return Ok(false);
            }
            let previous_settings = ctx.settings.clone();
            if let Some(effect) = ctx.catalog.cycle_value(*ctx.selected, ctx.filtered)? {
                ctx.catalog.sync_to_runtime(ctx.settings)?;
                if ctx.settings.approval_policy == crate::settings::ApprovalPolicy::AlwaysAllow
                    && previous_settings.approval_policy
                        != crate::settings::ApprovalPolicy::AlwaysAllow
                    && !confirm_always_allow(ctx.stdout)?
                {
                    *ctx.settings = previous_settings;
                    *ctx.catalog = SettingCatalog::from_runtime(ctx.settings, ctx.agent);
                    return Ok(false);
                }
                if effect != SettingApplyEffect::ReadOnly {
                    if let Err(error) =
                        apply_setting_change(effect, ctx.settings, ctx.agent, ctx.args)
                    {
                        *ctx.settings = previous_settings;
                        *ctx.catalog = SettingCatalog::from_runtime(ctx.settings, ctx.agent);
                        return Err(error);
                    }
                    show_status(ctx.stdout, apply_status_message(effect))?;
                }
            }
        }
        KeyCode::Backspace => {
            ctx.filter.pop();
        }
        KeyCode::Char(ch) if !key.modifiers.contains(KeyModifiers::CONTROL) && !ch.is_control() => {
            ctx.filter.push(ch);
        }
        _ => {}
    }
    Ok(false)
}

fn confirm_always_allow(stdout: &mut impl Write) -> Result<bool> {
    let mut input = String::new();
    loop {
        queue!(
            stdout,
            Print("\r\n  WARNING: always-allow permits every enabled tool.\r\n"),
            Print("  Type ALLOW to continue, or Esc to cancel: "),
            Print(&input),
            Print("\r\n")
        )
        .context("write always-allow confirmation")?;
        stdout.flush().context("flush always-allow confirmation")?;

        if !event::poll(std::time::Duration::from_millis(100))
            .context("poll always-allow confirmation")?
        {
            continue;
        }
        let Event::Key(key) = event::read().context("read always-allow confirmation")? else {
            continue;
        };
        match key.code {
            KeyCode::Esc => return Ok(false),
            KeyCode::Backspace => {
                input.pop();
            }
            KeyCode::Enter => return Ok(input == "ALLOW"),
            KeyCode::Char(ch)
                if !key.modifiers.contains(KeyModifiers::CONTROL) && !ch.is_control() =>
            {
                input.push(ch);
            }
            _ => {}
        }
    }
}

fn render_screen(
    stdout: &mut impl Write,
    catalog: &SettingCatalog,
    filter: &str,
    filtered: &[usize],
    selected: usize,
) -> Result<()> {
    let (width, height) = size().unwrap_or((80, 24));
    queue!(stdout, MoveTo(0, 0), Clear(ClearType::All)).context("clear settings screen")?;

    let title = "MoonTide settings";
    queue!(stdout, Print(title), Print("\r\n")).context("write settings title")?;
    queue!(stdout, Print(format!("search: {filter}\r\n"))).context("write settings filter")?;
    queue!(stdout, Print("\r\n")).ok();

    if filtered.is_empty() {
        queue!(
            stdout,
            Print("  No matching settings\r\n"),
            Print("\r\n"),
            Print(format!("  {HINT}\r\n"))
        )
        .context("write empty settings list")?;
    } else {
        let max_label = catalog
            .entries()
            .iter()
            .map(|entry| entry.label.len())
            .max()
            .unwrap_or(0)
            .min(28);
        let visible_rows = height.saturating_sub(8) as usize;
        let start = selected.saturating_sub(visible_rows / 2);
        let end = (start + visible_rows).min(filtered.len());

        for (row, &entry_index) in filtered[start..end].iter().enumerate() {
            let entry = &catalog.entries()[entry_index];
            let is_selected = start + row == selected;
            let prefix = if is_selected { "> " } else { "  " };
            let label = truncate(entry.label, max_label);
            let value = truncate(
                &entry.current_value,
                width.saturating_sub(max_label as u16 + 8) as usize,
            );
            if is_selected {
                queue!(
                    stdout,
                    SetAttribute(Attribute::Bold),
                    Print(format!("{prefix}{label:<max_label$}  {value}\r\n")),
                    ResetColor
                )
                .context("write selected setting row")?;
            } else {
                queue!(
                    stdout,
                    Print(format!("{prefix}{label:<max_label$}  {value}\r\n"))
                )
                .context("write setting row")?;
            }
        }

        if filtered.len() > visible_rows {
            queue!(
                stdout,
                Print(format!(
                    "  ({}/{filtered_len})\r\n",
                    selected + 1,
                    filtered_len = filtered.len()
                ))
            )
            .ok();
        }

        if let Some(entry) = catalog.entries().get(filtered[selected]) {
            queue!(
                stdout,
                Print("\r\n"),
                Print(format!("  {}\r\n", entry.description))
            )
            .ok();
        }

        queue!(stdout, Print("\r\n"), Print(format!("  {HINT}\r\n"))).ok();
    }

    stdout.flush().context("flush settings render")?;
    Ok(())
}

fn show_status(stdout: &mut impl Write, message: &str) -> Result<()> {
    queue!(
        stdout,
        Print("\r\n"),
        Print(format!("  applied: {message}\r\n"))
    )
    .context("write settings status")?;
    stdout.flush().ok();
    Ok(())
}

fn truncate(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_owned();
    }
    let mut chars = value.chars();
    let prefix: String = chars.by_ref().take(max_chars.saturating_sub(1)).collect();
    format!("{prefix}…")
}
