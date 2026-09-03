use anyhow::{
    Result,
    bail,
};

use crate::model_input::{
    LlmCallConfig,
    SystemPrompt,
};

/// Inputs resolved by the composition root for one user Turn.
pub struct TurnInput {
    pub text: String,
    pub config: LlmCallConfig,
    pub system_prompt: SystemPrompt,
    pub policy: TurnPolicy,
}

/// Bounds for one Turn's model-step execution.
pub struct TurnPolicy {
    pub max_steps: u32,
    pub max_llm_retries: u32,
}

impl TurnPolicy {
    pub fn new(max_steps: u32) -> Result<Self> {
        if max_steps == 0 {
            bail!("turn max_steps must be greater than zero");
        }
        Ok(Self {
            max_steps,
            max_llm_retries: 3,
        })
    }

    pub(crate) fn validate(&self) -> Result<()> {
        if self.max_steps == 0 {
            bail!("turn max_steps must be greater than zero");
        }
        if self.max_llm_retries > 3 {
            bail!("turn max_llm_retries must be between zero and three");
        }
        Ok(())
    }
}
