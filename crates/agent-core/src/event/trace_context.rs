/// Correlation fields threaded through hook / commit / observe handlers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TraceContext {
    pub run_id: String,
    pub session_id: String,
    pub turn: u64,
    pub step: u32,
    pub llm_call_id: Option<String>,
    pub tool_use_id: Option<String>,
    pub session_item_id: Option<String>,
}

impl TraceContext {
    pub fn new(run_id: impl Into<String>, session_id: impl Into<String>) -> Self {
        Self {
            run_id: run_id.into(),
            session_id: session_id.into(),
            turn: 0,
            step: 0,
            llm_call_id: None,
            tool_use_id: None,
            session_item_id: None,
        }
    }
}
