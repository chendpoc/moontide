use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use ocula_llm::{LlmChatResponse, LlmClient};
use ocula_protocol::{ContentBlock, Message, ToolSchema};

pub struct MockLlmClient {
    responses: std::sync::Mutex<Vec<LlmChatResponse>>,
}

impl MockLlmClient {
    pub fn new(responses: Vec<LlmChatResponse>) -> Self {
        Self {
            responses: std::sync::Mutex::new(responses),
        }
    }

    pub fn text(reply: &str) -> LlmChatResponse {
        LlmChatResponse {
            content: vec![ContentBlock::Text {
                text: reply.into(),
            }],
            stop_reason: "end_turn".into(),
        }
    }

    pub fn tool_use(id: &str, name: &str, input: serde_json::Value) -> LlmChatResponse {
        LlmChatResponse {
            content: vec![ContentBlock::ToolUse {
                id: id.into(),
                name: name.into(),
                input,
            }],
            stop_reason: "tool_use".into(),
        }
    }
}

#[async_trait]
impl LlmClient for MockLlmClient {
    async fn chat(
        &self,
        _messages: &[Message],
        _tools: &[ToolSchema],
        _system: &str,
    ) -> Result<LlmChatResponse> {
        let mut guard = self.responses.lock().unwrap();
        if guard.is_empty() {
            anyhow::bail!("no mock responses left");
        }
        Ok(guard.remove(0))
    }
}

pub fn mock_llm(responses: Vec<LlmChatResponse>) -> Arc<dyn LlmClient> {
    Arc::new(MockLlmClient::new(responses))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::AgentSession;
    use ocula_observability::ObservabilityState;
    use ocula_tools::{AutoApproveInteraction, READ_FILE};
    use std::sync::Arc;
    use tempfile::tempdir;

    fn test_obs() -> Arc<ObservabilityState> {
        Arc::new(ObservabilityState::default())
    }

    #[tokio::test]
    async fn end_turn_returns_reply() {
        let dir = tempdir().unwrap();
        let agent = AgentSession::new(
            dir.path(),
            mock_llm(vec![MockLlmClient::text("Hello from model")]),
            Arc::new(AutoApproveInteraction),
            test_obs(),
        );

        let result = agent.run("hi").await.unwrap();
        assert_eq!(result.reply, "Hello from model");
        assert_eq!(result.turn, 1);
    }

    #[tokio::test]
    async fn tool_use_then_end_turn() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("demo.txt"), "file content").unwrap();

        let agent = AgentSession::new(
            dir.path(),
            mock_llm(vec![
                MockLlmClient::tool_use(
                    "toolu_1",
                    READ_FILE,
                    serde_json::json!({ "path": "demo.txt" }),
                ),
                MockLlmClient::text("done"),
            ]),
            Arc::new(AutoApproveInteraction),
            test_obs(),
        );

        let result = agent.run("read demo.txt").await.unwrap();
        assert_eq!(result.reply, "done");
        assert_eq!(result.turn, 2);

        let log = agent.session.read_log().await.unwrap();
        assert!(log.len() >= 4);
    }

    #[tokio::test]
    async fn tool_use_with_thinking_trace_enabled() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("demo.txt"), "file content").unwrap();

        let obs = Arc::new(ObservabilityState::default());
        obs.set_thinking_override(Some(true));

        let agent = AgentSession::new(
            dir.path(),
            mock_llm(vec![
                MockLlmClient::tool_use(
                    "toolu_1",
                    READ_FILE,
                    serde_json::json!({ "path": "demo.txt" }),
                ),
                MockLlmClient::text("done"),
            ]),
            Arc::new(AutoApproveInteraction),
            obs,
        );

        let result = agent.run("read demo.txt").await.unwrap();
        assert_eq!(result.reply, "done");
        assert_eq!(result.turn, 2);
    }
}
