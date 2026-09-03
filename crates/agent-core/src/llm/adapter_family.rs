use std::fmt;

use serde::{
    Deserialize,
    Serialize,
};

/// Wire protocol family (paired 1:1 with `normalize/{family}/` and `adapter/{family}/`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, PartialOrd, Ord)]
#[serde(rename_all = "kebab-case")]
pub enum AdapterFamily {
    OpenAiChatCompletions,
    OpenAiResponses,
    AnthropicMessages,
    GoogleGenerativeAi,
}

impl AdapterFamily {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::OpenAiChatCompletions => "openai-chat-completions",
            Self::OpenAiResponses => "openai-responses",
            Self::AnthropicMessages => "anthropic-messages",
            Self::GoogleGenerativeAi => "google-generative-ai",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "openai-chat-completions" | "openai_chat_completions" => {
                Some(Self::OpenAiChatCompletions)
            }
            "openai-responses" | "openai_responses" => Some(Self::OpenAiResponses),
            "anthropic-messages" | "anthropic_messages" => Some(Self::AnthropicMessages),
            "google-generative-ai" | "google_generative_ai" => Some(Self::GoogleGenerativeAi),
            _ => None,
        }
    }
}

impl fmt::Display for AdapterFamily {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}
