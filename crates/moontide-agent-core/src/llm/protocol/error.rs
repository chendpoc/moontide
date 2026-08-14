use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CancelReason {
    User,
    Parent,
    Hook,
    Disposed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RequestFailureKind {
    Recoverable,
    Unrecoverable,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LlmError {
    Cancelled { reason: CancelReason },
    RequestFailed {
        kind: RequestFailureKind,
        message: String,
    },
}

impl fmt::Display for LlmError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Cancelled { reason } => write!(f, "llm call cancelled: {reason:?}"),
            Self::RequestFailed { kind, message } => {
                write!(f, "llm request failed ({kind:?}): {message}")
            }
        }
    }
}

impl std::error::Error for LlmError {}
