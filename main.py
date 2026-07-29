#!/usr/bin/env python3
"""Oculus CLI — interactive coding agent."""

from __future__ import annotations

try:
    import readline

    readline.parse_and_bind("set bind-tty-special-chars off")
    readline.parse_and_bind("set input-meta on")
    readline.parse_and_bind("set output-meta on")
    readline.parse_and_bind("set convert-meta off")
except ImportError:
    pass

from oculus.config import WORKDIR
from oculus.loop import run_agent


def main() -> None:
    print("Oculus — coding agent")
    print(f"Workspace: {WORKDIR}")
    print("Enter a task, or q to quit.\n")

    while True:
        try:
            query = input("\033[36moculus >> \033[0m")
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if query.strip().lower() in ("q", "exit", "") or not query.strip():
            break
        reply = run_agent(query)
        print(reply)
        print()


if __name__ == "__main__":
    main()
