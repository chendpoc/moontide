/// R0 REPL command list (aligned with TS `/help`, TS-only items noted).
pub fn help_text() -> String {
    [
        "REPL commands:",
        "  /help · /reset · /workdir",
        "  /thinking on|off|status · /verbose on|off|status  (call chain & debug trace)",
        "  /always-allow on|off|status  (auto-approve ask-class tools)",
        "  /new · /exit",
        "  q · exit",
        "",
        "TS-only (not in Rust R0): /status · /compact",
        "",
        "Env: MOONTIDE_ENV=dev · MOONTIDE_THINKING=1 · MOONTIDE_VERBOSE=1 · MOONTIDE_ALWAYS_ALLOW=1",
    ]
    .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn help_mentions_observability() {
        let text = help_text();
        assert!(text.contains("/thinking"));
        assert!(text.contains("/verbose"));
        assert!(text.contains("MOONTIDE_THINKING"));
    }
}
