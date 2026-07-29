"""Permission gate tests."""

from __future__ import annotations

from oculus.permissions import check_permission


def test_deny_rm_rf():
    assert check_permission("bash", {"command": "rm -rf /"}) == "deny"


def test_destructive_rm_asks():
    assert check_permission("bash", {"command": "rm foo.txt"}) == "ask"


def test_safe_bash_allowed():
    assert check_permission("bash", {"command": "echo hi"}) == "allow"


def test_write_inside_workspace_allowed():
    assert check_permission("write_file", {"path": "ok.txt", "content": "hi"}) == "allow"
