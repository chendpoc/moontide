"""LLM client — DeepSeek via Anthropic-compatible API."""

from __future__ import annotations

from typing import Any

from anthropic import Anthropic

from oculus.config import api_key, base_url, model_id

_client: Anthropic | None = None


def get_client() -> Anthropic:
    global _client
    if _client is None:
        _client = Anthropic(api_key=api_key(), base_url=base_url())
    return _client


def extract_text(content: Any) -> str:
    """Extract user-visible text from message content blocks."""
    if isinstance(content, str):
        return content.strip()
    parts: list[str] = []
    for block in content:
        if getattr(block, "type", None) == "text":
            parts.append(block.text)
    return "\n".join(parts).strip()


def chat(
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    *,
    system: str,
    max_tokens: int = 8000,
) -> Any:
    return get_client().messages.create(
        model=model_id(),
        system=system,
        messages=messages,
        tools=tools,
        max_tokens=max_tokens,
    )
