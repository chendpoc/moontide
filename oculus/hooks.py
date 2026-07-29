"""Hook registry — extend the loop without bloating it."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Optional

from oculus.permissions import check_permission

HookFn = Callable[..., Optional[str]]

HOOKS: dict[str, list[HookFn]] = {
    "UserPromptSubmit": [],
    "PreToolUse": [],
    "PostToolUse": [],
    "Stop": [],

    # 在 llm 调用前后触发
    "PreLLM": [],
    "PostLLM": [],
}


def register(event: str, callback: HookFn) -> None:
    HOOKS.setdefault(event, []).append(callback)


def run(event: str, **context: Any) -> str | None:
    for callback in HOOKS.get(event, []):
        result = callback(**context)
        if result is not None:
            return str(result)
    return None


def permission_hook(*, tool_name: str, tool_input: dict[str, Any]) -> str | None:
    decision = check_permission(tool_name, tool_input)
    if decision == "deny":
        return f"Permission denied: {tool_name}"
    if decision == "ask":
        return f"Permission required: {tool_name} needs user approval"
    return None


def audit_hook(*, tool_name: str, tool_input: dict[str, Any]) -> None:
    log_path = Path(".oculus-audit.log")
    line = f"{datetime.now().isoformat()}\t{tool_name}\t{tool_input}\n"
    with log_path.open("a", encoding="utf-8") as handle:
        handle.write(line)
    return None

def pre_llm_hook(*, messages: list[dict[str, Any]]) -> None:
    pass

def post_llm_hook(*, messages: list[dict[str, Any]]) -> None:
    pass

def setup_default_hooks() -> None:
    HOOKS["PreToolUse"].clear()
    register("PreToolUse", audit_hook)
    register("PreToolUse", permission_hook)
    
    register("PreLLM", pre_llm_hook)
    register("PostLLM", post_llm_hook)
