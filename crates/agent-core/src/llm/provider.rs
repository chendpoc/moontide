use std::pin::Pin;

use futures::Stream;
use futures::StreamExt;

use crate::llm::protocol::{
    LlmError, ModelRequest, ModelResponse, ModelResponseSnapshot, ModelStreamEvent,
};
use crate::llm::ModelResponseBuilder;

/// Streaming LLM port. Implementations must emit exactly one [`ModelStreamEvent::Finished`] last on success.
pub trait LLMProvider: Send + Sync {
    fn stream(
        &self,
        request: ModelRequest,
    ) -> Pin<Box<dyn Stream<Item = Result<ModelStreamEvent, LlmError>> + Send + '_>>;
}

/// Collect a stream into a [`ModelResponse`] without streaming UI updates.
pub async fn run_model_call(
    provider: &dyn LLMProvider,
    request: ModelRequest,
) -> Result<ModelResponse, LlmError> {
    run_model_call_with_updates(provider, request, |_| {}).await
}

/// Fold the provider stream via [`ModelResponseBuilder`], invoking `on_update` after each event.
pub async fn run_model_call_with_updates<F>(
    provider: &dyn LLMProvider,
    request: ModelRequest,
    mut on_update: F,
) -> Result<ModelResponse, LlmError>
where
    F: FnMut(ModelResponseSnapshot),
{
    let model = request.model.clone();
    let mut builder = ModelResponseBuilder::new(model);
    let mut stream = provider.stream(request);

    while let Some(item) = stream.next().await {
        let snapshot = builder.apply(item?)?;
        on_update(snapshot);
    }

    builder.finish()
}

/// Alias for [`run_model_call`].
pub async fn complete(
    provider: &dyn LLMProvider,
    request: ModelRequest,
) -> Result<ModelResponse, LlmError> {
    run_model_call(provider, request).await
}
