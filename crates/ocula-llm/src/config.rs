use std::env;

pub const DEEPSEEK_ANTHROPIC_BASE_URL: &str = "https://api.deepseek.com/anthropic";
pub const DEFAULT_MODEL: &str = "deepseek-v4-pro";
pub const DEFAULT_MAX_TOKENS: u32 = 8000;

#[derive(Debug, Clone)]
pub struct LlmConfig {
    pub api_key: String,
    pub base_url: String,
    pub model_id: String,
    pub max_tokens: u32,
}

impl LlmConfig {
    pub fn from_env() -> anyhow::Result<Self> {
        dotenvy::dotenv().ok();
        let api_key = env::var("DEEPSEEK_API_KEY")
            .or_else(|_| env::var("ANTHROPIC_API_KEY"))
            .map_err(|_| anyhow::anyhow!("Set DEEPSEEK_API_KEY (or ANTHROPIC_API_KEY) in .env"))?;
        let base_url = env::var("ANTHROPIC_BASE_URL")
            .unwrap_or_else(|_| DEEPSEEK_ANTHROPIC_BASE_URL.to_string());
        let model_id = env::var("MODEL_ID").unwrap_or_else(|_| DEFAULT_MODEL.to_string());
        Ok(Self {
            api_key,
            base_url,
            model_id,
            max_tokens: DEFAULT_MAX_TOKENS,
        })
    }
}
