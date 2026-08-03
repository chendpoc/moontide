mod approval;
mod help;
mod observability;

pub use approval::*;
pub use help::*;
pub use observability::*;

/// Parse `/command arg` into `(command, optional arg)`.
pub fn parse_repl_command(line: &str) -> Option<(&str, Option<&str>)> {
    let trimmed = line.trim();
    if !trimmed.starts_with('/') {
        return None;
    }
    let rest = trimmed.trim_start_matches('/');
    let mut parts = rest.splitn(2, char::is_whitespace);
    let cmd = parts.next()?;
    let arg = parts.next().map(str::trim).filter(|s| !s.is_empty());
    Some((cmd, arg))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_thinking_with_arg() {
        assert_eq!(
            parse_repl_command("/thinking on"),
            Some(("thinking", Some("on")))
        );
    }

    #[test]
    fn parse_always_allow_command() {
        assert_eq!(
            parse_repl_command("/always-allow on"),
            Some(("always-allow", Some("on")))
        );
    }

    #[test]
    fn parse_bare_command() {
        assert_eq!(parse_repl_command("/help"), Some(("help", None)));
    }
}
