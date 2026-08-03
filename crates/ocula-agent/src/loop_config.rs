use ocula_protocol::Message;
use ocula_tools::ToolProjectionConfig;

pub trait LoopConfig: Send + Sync {
    fn transform_context(&self, messages: Vec<Message>) -> Vec<Message> {
        messages
    }
}

pub struct NoOpLoopConfig;

impl LoopConfig for NoOpLoopConfig {}

pub struct PruneLoopConfig {
    pub keep_turns: u32,
}

impl Default for PruneLoopConfig {
    fn default() -> Self {
        Self {
            keep_turns: ToolProjectionConfig::from_env().keep_turns,
        }
    }
}

impl LoopConfig for PruneLoopConfig {
    fn transform_context(&self, messages: Vec<Message>) -> Vec<Message> {
        ocula_composer::prune_messages(messages, self.keep_turns).0
    }
}
