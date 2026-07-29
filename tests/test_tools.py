"""Offline tool tests."""

from __future__ import annotations

import pytest

from oculus.tools import run_bash, run_edit, run_read, run_write, safe_path, set_workdir


@pytest.fixture
def workspace(tmp_path):
    set_workdir(tmp_path)
    yield tmp_path


def test_write_and_read(workspace):
    assert "Wrote" in run_write("demo.txt", "hello\nworld")
    assert "hello" in run_read("demo.txt")


def test_edit_file(workspace):
    run_write("edit.txt", "foo bar baz")
    assert "Edited" in run_edit("edit.txt", "bar", "qux")
    assert run_read("edit.txt") == "foo qux baz"


def test_safe_path_blocks_escape(workspace):
    with pytest.raises(ValueError):
        safe_path("../escape.txt")


def test_bash_echo(workspace):
    assert "harness" in run_bash("echo harness")
