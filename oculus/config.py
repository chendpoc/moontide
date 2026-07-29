"""Runtime configuration from environment."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(override=True)

# DeepSeek: Anthropic-compatible endpoint (see learn-claude-code/.env.example)
if os.getenv("DEEPSEEK_API_KEY") and not os.getenv("ANTHROPIC_API_KEY"):
    os.environ["ANTHROPIC_API_KEY"] = os.environ["DEEPSEEK_API_KEY"]

if os.getenv("DEEPSEEK_API_KEY") and not os.getenv("ANTHROPIC_BASE_URL"):
    os.environ["ANTHROPIC_BASE_URL"] = "https://api.deepseek.com/anthropic"

if os.getenv("ANTHROPIC_BASE_URL"):
    os.environ.pop("ANTHROPIC_AUTH_TOKEN", None)

WORKDIR = Path(os.getenv("OCULUS_WORKDIR", Path.cwd())).resolve()

DEFAULT_MODEL = "deepseek-v4-pro"


def require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing environment variable: {name}")
    return value


def api_key() -> str:
    key = os.getenv("ANTHROPIC_API_KEY") or os.getenv("DEEPSEEK_API_KEY")
    if not key:
        raise RuntimeError("Set DEEPSEEK_API_KEY (or ANTHROPIC_API_KEY) in .env")
    return key


def base_url() -> str:
    return os.getenv("ANTHROPIC_BASE_URL", "https://api.deepseek.com/anthropic")


def model_id() -> str:
    return os.getenv("MODEL_ID", DEFAULT_MODEL)
