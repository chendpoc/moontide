"""Agent loop kernel — stable while features grow via hooks and tools."""

from __future__ import annotations

from typing import Any

from oculus.hooks import run as run_hooks
from oculus.hooks import setup_default_hooks
from oculus.llm import chat, extract_text
from oculus.prompt import build_system_prompt
from oculus.tools import TOOL_HANDLERS, TOOL_SCHEMAS, execute_tool


def agent_loop(messages: list[dict[str, Any]]) -> str:
    setup_default_hooks()
    system = build_system_prompt()

    while True:
        response = chat(messages, TOOL_SCHEMAS, system=system)
        messages.append({"role": "assistant", "content": response.content})

        if response.stop_reason != "tool_use":
            run_hooks("Stop", messages=messages)
            return extract_text(response.content)

        results: list[dict[str, str]] = []
        for block in response.content:
            if block.type != "tool_use":
                continue

            blocked = run_hooks(
                "PreToolUse",
                tool_name=block.name,
                tool_input=block.input,
            )
            if blocked:
                results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": blocked,
                    }
                )
                continue

            output = execute_tool(block.name, block.input)
            run_hooks(
                "PostToolUse",
                tool_name=block.name,
                tool_input=block.input,
                output=output,
            )
            results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": output,
                }
            )

        messages.append({"role": "user", "content": results})


def run_agent(user_prompt: str) -> str:
    run_hooks("UserPromptSubmit", prompt=user_prompt)
    messages = [{"role": "user", "content": user_prompt}]
    return agent_loop(messages)
