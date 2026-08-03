use ocula_protocol::Message;

pub trait LoopConfig: Send + Sync {
    fn transform_context(&self, messages: Vec<Message>) -> Vec<Message> {
        messages
    }
}

pub struct NoOpLoopConfig;

impl LoopConfig for NoOpLoopConfig {}
