use std::{
    borrow::Cow,
    io,
    sync::{Arc, Mutex},
};

use anyhow::{Context, Result};
use rustyline::{
    completion::{Completer, Pair},
    config::Configurer,
    error::ReadlineError,
    highlight::{CmdKind, Highlighter},
    hint::Hinter,
    history::DefaultHistory,
    validate::{ValidationContext, ValidationResult, Validator},
    ColorMode, Editor, Helper,
};

type TerminalEditor = Editor<MaskingHelper, DefaultHistory>;

/// The single terminal input owner shared by Settings, REPL, and approval.
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
        _line: &str,
        pos: usize,
        _ctx: &rustyline::Context<'_>,
    ) -> rustyline::Result<(usize, Vec<Self::Candidate>)> {
        Ok((pos, Vec::new()))
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
    fn validate(&self, _ctx: &mut ValidationContext) -> rustyline::Result<ValidationResult> {
        Ok(ValidationResult::Valid(None))
    }
}

impl Helper for MaskingHelper {}
