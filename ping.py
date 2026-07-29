#!/usr/bin/env python3
"""Ping DeepSeek API — verify .env before running the agent."""

from __future__ import annotations

import sys

from oculus.config import model_id
from oculus.llm import extract_text, get_client


def ping(user_text: str) -> str:
    response = get_client().messages.create(
        model=model_id(),
        max_tokens=512,
        messages=[{"role": "user", "content": user_text}],
    )
    if not response.content:
        return "(empty response)"
    text = extract_text(response.content)
    return text or "(empty response)"


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python ping.py <message>")
        sys.exit(1)
    try:
        print(ping(sys.argv[1]))
    except Exception as exc:
        print(f"Error: {exc}")
        sys.exit(1)


if __name__ == "__main__":
    main()
