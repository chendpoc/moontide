"""Permission gates before tool execution."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

from oculus.config import WORKDIR

Decision = Literal["allow", "deny", "ask"]

DENY_LIST = ["rm -rf /", "sudo", "shutdown", "reboot", "mkfs", "dd if="]
DESTRUCTIVE_HINTS = ["rm ", "> /etc/", "chmod 777"]


def _escapes_workspace(path: str) -> bool:
    raw = Path(path)
    if raw.is_absolute():
        try:
            return not raw.resolve().is_relative_to(WORKDIR.resolve())
        except (ValueError, OSError):
            return True
    try:
        resolved = (WORKDIR / raw).resolve()
        return not resolved.is_relative_to(WORKDIR.resolve())
    except (ValueError, OSError):
        return True


def check_permission(tool_name: str, tool_input: dict[str, Any]) -> Decision:
    if tool_name == "bash":
        command = tool_input.get("command", "")
        for pattern in DENY_LIST:
            if pattern in command:
                return "deny"
        for hint in DESTRUCTIVE_HINTS:
            if hint in command:
                return "ask"

    if tool_name in ("write_file", "edit_file") and _escapes_workspace(
        tool_input.get("path", "")
    ):
        return "ask"

    return "allow"
