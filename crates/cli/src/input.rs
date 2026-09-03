use std::borrow::Cow;
use std::io;
use std::sync::{
    Arc,
    Mutex,
};

use anyhow::{
    Context,
    Result,
};
use rustyline::completion::{
    Completer,
    Pair,
};
use rustyline::config::Configurer;
use rustyline::error::ReadlineError;
use rustyline::highlight::{
    CmdKind,
    Highlighter,
};
use rustyline::hint::Hinter;
use rustyline::history::DefaultHistory;
use rustyline::validate::{
    ValidationContext,
    ValidationResult,
    Validator,
};
use rustyline::{
    ColorMode,
    Editor,
    Helper,
};

type TerminalEditor = Editor<MaskingHelper, DefaultHistory>;

pub(crate) const SLASH_COMMANDS: &[&str] = &[
    "/exit",
    "/help",
    "/id",
    "/new",
    "/resume",
    "/sessions",
    "/settings",
    "/status",
    "/thinking",
    "/thinking off",
    "/thinking on",
];

/// The single terminal input owner shared by Settings, console, and approval.
#[derive(Clone)]
pub(crate) struct InputOwner {
    editor: Arc<Mutex<TerminalEditor>>,
}

impl InputOwner {
    pub(crate) fn new() -> Result<Self> {
        let mut editor = TerminalEditor::new().map_err(anyhow::Error::new)?;
        editor.set_auto_add_history(false);
        editor.set_helper(Some(MaskingHelper { masking: false }));
        Ok(Self {
            editor: Arc::new(Mutex::new(editor)),
        })
    }

    pub(crate) fn readline(&self, prompt: &str) -> rustyline::Result<String> {
        let mut editor = self.editor.lock().map_err(|_| {
            ReadlineError::Io(io::Error::other("terminal input owner lock poisoned"))
        })?;
        editor.readline(prompt)
    }

    pub(crate) fn add_history_entry(&self, line: &str) -> rustyline::Result<bool> {
        let mut editor = self.editor.lock().map_err(|_| {
            ReadlineError::Io(io::Error::other("terminal input owner lock poisoned"))
        })?;
        editor.add_history_entry(line)
    }

    pub(crate) fn read_secret(&self) -> Result<String> {
        let mut editor = self
            .editor
            .lock()
            .map_err(|_| anyhow::anyhow!("terminal input owner lock poisoned"))?;
        if let Some(helper) = editor.helper_mut() {
            helper.masking = true;
        }
        editor.set_color_mode(ColorMode::Forced);
        editor.set_auto_add_history(false);
        let cursor_guard = editor
            .set_cursor_visibility(false)
            .map_err(anyhow::Error::new)
            .context("hide secret input cursor")?;
        let result = editor.readline("");
        drop(cursor_guard);
        if let Some(helper) = editor.helper_mut() {
            helper.masking = false;
        }
        result.map_err(anyhow::Error::new)
    }
}

#[derive(Debug)]
struct MaskingHelper {
    masking: bool,
}

impl Completer for MaskingHelper {
    type Candidate = Pair;

    fn complete(
        &self,
        line: &str,
        pos: usize,
        _ctx: &rustyline::Context<'_>,
    ) -> rustyline::Result<(usize, Vec<Self::Candidate>)> {
        if self.masking || !line.starts_with('/') {
            return Ok((pos, Vec::new()));
        }
        let prefix = &line[..pos.min(line.len())];
        let matches = SLASH_COMMANDS
            .iter()
            .filter(|command| command.starts_with(prefix))
            .map(|command| Pair {
                display: (*command).to_owned(),
                replacement: (*command).to_owned(),
            })
            .collect();
        Ok((0, matches))
    }
}

impl Hinter for MaskingHelper {
    type Hint = String;
}

impl Highlighter for MaskingHelper {
    fn highlight<'l>(&self, line: &'l str, _pos: usize) -> Cow<'l, str> {
        if self.masking {
            Cow::Owned(" ".repeat(line.chars().count()))
        } else {
            Cow::Borrowed(line)
        }
    }

    fn highlight_char(&self, _line: &str, _pos: usize, kind: CmdKind) -> bool {
        !matches!(kind, CmdKind::MoveCursor) && self.masking
    }
}

impl Validator for MaskingHelper {
    fn validate(&self, ctx: &mut ValidationContext) -> rustyline::Result<ValidationResult> {
        if self.masking {
            return Ok(ValidationResult::Valid(None));
        }
        if ctx.input().ends_with('\\') {
            Ok(ValidationResult::Incomplete)
        } else {
            Ok(ValidationResult::Valid(None))
        }
    }
}

impl Helper for MaskingHelper {}

pub(crate) fn normalize_input(line: String) -> String {
    if !line.contains('\\') && !line.contains('\n') {
        return line;
    }
    line.lines()
        .map(|part| part.strip_suffix('\\').unwrap_or(part))
        .collect::<Vec<_>>()
        .join("\n")
}
