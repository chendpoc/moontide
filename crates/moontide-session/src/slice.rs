use moontide_protocol::{Message, SessionLog};

pub struct SessionLogSlice {
    log: Vec<SessionLog>,
}

impl SessionLogSlice {
    pub fn from_log(log: Vec<SessionLog>) -> Self {
        Self { log }
    }

    pub fn log(&self) -> &[SessionLog] {
        &self.log
    }

    pub fn to_messages(&self, up_to_turn: Option<u32>) -> Vec<Message> {
        moontide_composer::log_to_messages(&self.log, up_to_turn, None)
    }
}
