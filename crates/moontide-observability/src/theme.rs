//! Terminal theme aligned with TS `src/log/format/format-trace.ts`.

use owo_colors::OwoColorize;

const TOOL_ORANGE: (u8, u8, u8) = (255, 165, 0);

pub fn startup_banner() -> String {
    format!("{} — type /help for commands", "MoonTide".bold())
}

pub fn session_line(session_id: &str) -> String {
    format!("Session: {}", session_id.bright_black())
}

pub fn turn_banner(turn: u32) -> String {
    format!("── turn {turn} ──").yellow().bold().to_string()
}

pub fn compose_summary_line(
    message_count: usize,
    tool_count: usize,
    system_chars: usize,
    truncated_count: u32,
    artifact_count: u32,
) -> String {
    let mut line = format!(
        "  {}: {} messages · {} tools · ~{} chars system",
        "context".cyan(),
        message_count.to_string().cyan(),
        tool_count.to_string().cyan(),
        system_chars.to_string().cyan(),
    );
    if truncated_count > 0 || artifact_count > 0 {
        line.push_str(&format!(
            " · {} truncated · {} artifacts",
            truncated_count.to_string().yellow(),
            artifact_count.to_string().yellow(),
        ));
    }
    line
}

pub fn thinking_line(preview: &str) -> String {
    format!("  {} {}  {}", rail(), label_think(), dim(preview))
}

pub fn tool_use_line(name: &str, preview: &str) -> String {
    format!("  {} {}  {}", rail(), label_tool(name), dim(preview))
}

pub fn tool_result_line(
    char_count: usize,
    preview: &str,
    artifact_id: Option<&str>,
    truncated: bool,
) -> String {
    let suffix = match (truncated, artifact_id) {
        (true, Some(id)) => format!(", truncated, artifact {id}"),
        (true, None) => ", truncated".into(),
        (false, Some(id)) => format!(", artifact {id}"),
        (false, None) => String::new(),
    };
    format!(
        "  {} {} {}",
        rail(),
        label_result(char_count, &suffix),
        dim_result_preview(preview, truncated)
    )
}

pub fn error_line(message: &str) -> String {
    format!("Error: {}", message.red())
}

fn rail() -> String {
    "▸".bright_black().to_string()
}

fn label_think() -> String {
    format!("{}  ", "thinking".blue())
}

fn label_tool(name: &str) -> String {
    format!(
        "{}  ",
        format!("tool   {name}").truecolor(TOOL_ORANGE.0, TOOL_ORANGE.1, TOOL_ORANGE.2)
    )
}

fn label_result(char_count: usize, suffix: &str) -> String {
    format!("result ({char_count}{suffix})").green().to_string()
}

fn dim(text: &str) -> String {
    text.bright_black().to_string()
}

fn dim_result_preview(text: &str, truncated: bool) -> String {
    if truncated {
        text.bright_black().yellow().to_string()
    } else {
        text.bright_black().to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn banner_contains_help_hint() {
        let banner = startup_banner();
        assert!(banner.contains("/help"));
    }

    #[test]
    fn turn_banner_includes_turn_number() {
        assert!(turn_banner(3).contains("turn 3"));
    }

    #[test]
    fn compose_summary_shows_truncation_stats() {
        let line = compose_summary_line(5, 10, 1000, 2, 1);
        assert!(line.contains("truncated"));
        assert!(line.contains("artifacts"));
    }
}
