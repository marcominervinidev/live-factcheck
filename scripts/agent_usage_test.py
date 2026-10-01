#!/usr/bin/env python3
"""Stdlib tests for scripts/agent-usage.py (no dependencies; runs on any python3).

Covers the containment check (Sonar S8707) with the attack table from the security review,
the Collector's aggregation semantics on fixed JSONL fixtures, and that log-derived names are
escaped in the dashboard HTML. Run: python3 scripts/agent_usage_test.py
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "agent_usage", Path(__file__).with_name("agent-usage.py")
)
assert SPEC is not None and SPEC.loader is not None
agent_usage = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(agent_usage)


class ResolveProjectTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name) / "projects"
        (self.base / "good").mkdir(parents=True)
        (Path(self.tmp.name) / "outside").mkdir()

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_direct_child_is_accepted(self) -> None:
        self.assertEqual(
            agent_usage.resolve_project(self.base, "good"), (self.base / "good").resolve()
        )

    def test_attack_table_is_rejected(self) -> None:
        for slug in ("..", "../outside", "../../etc", "/etc", "good/nested", ".", "", "missing"):
            with self.subTest(slug=slug), self.assertRaises(ValueError):
                agent_usage.resolve_project(self.base, slug)

    def test_symlink_child_pointing_outside_is_rejected(self) -> None:
        link = self.base / "link"
        os.symlink(Path(self.tmp.name) / "outside", link)
        with self.assertRaises(ValueError):
            agent_usage.resolve_project(self.base, "link")


def row(kind: str, stamp: str, **message: object) -> str:
    return json.dumps({"type": kind, "timestamp": stamp, "message": message})


FIXTURE = "\n".join(
    [
        # outside the window below
        row("assistant", "2026-01-01T00:00:00+00:00", model="m1",
            usage={"input_tokens": 999, "output_tokens": 999}),
        # synthetic rows never count
        row("assistant", "2026-02-01T10:00:00+00:00", model="<synthetic>",
            usage={"input_tokens": 50, "output_tokens": 50}),
        row("assistant", "2026-02-01T10:00:01+00:00", model="m1",
            usage={"input_tokens": 3, "cache_read_input_tokens": 100, "output_tokens": 7,
                   "output_tokens_details": {"thinking_tokens": 2}},
            content=[{"type": "tool_use", "id": "a", "name": "Bash", "input": {"c": "ls"}}]),
        # identical call directly after -> one repeat
        row("assistant", "2026-02-01T10:00:02+00:00", model="m1",
            usage={"input_tokens": 1, "output_tokens": 5},
            content=[{"type": "tool_use", "id": "b", "name": "Bash", "input": {"c": "ls"}}]),
        row("user", "2026-02-01T10:00:03+00:00",
            content=[{"type": "tool_result", "tool_use_id": "b", "is_error": True,
                      "content": "x" * 40}]),
        "not json at all",
    ]
)


class CollectTest(unittest.TestCase):
    def test_aggregates_filters_and_repeats(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "s1.jsonl").write_text(FIXTURE, encoding="utf-8")
            data = agent_usage.collect(
                Path(tmp), agent_usage.parse_when("2026-02-01T00:00:00+00:00"), None
            )
        self.assertEqual(data["sessions"], 1)
        self.assertEqual(data["turns"], 2)  # the synthetic and the out-of-window row never count
        self.assertEqual(set(data["tokens"]), {"m1"})
        self.assertEqual(data["tokens"]["m1"]["fresh"], 4)
        self.assertEqual(data["tokens"]["m1"]["out"], 12)
        self.assertEqual(data["tokens"]["m1"]["cache_read"], 100)
        self.assertEqual(data["tokens"]["m1"]["thinking"], 2)
        self.assertEqual(data["identical_repeats"], 1)
        self.assertEqual(data["tool_errors"], 1)
        self.assertEqual(data["tools"]["Bash"]["calls"], 2)
        self.assertEqual(data["tools"]["Bash"]["errors"], 1)
        self.assertEqual(data["tools"]["Bash"]["result_chars"], 40)
        self.assertEqual(data["daily"]["2026-02-01"]["turns"], 2)
        self.assertEqual(data["daily"]["2026-02-01"]["errors"], 1)
        self.assertEqual(data["window"][0][:10], "2026-02-01")


class DashboardEscapeTest(unittest.TestCase):
    def test_log_derived_names_are_escaped(self) -> None:
        data = {
            "sessions": 1,
            "turns": 1,
            "window": ["2026-02-01", "2026-02-01"],
            "tokens": {"<img src=x>": {"out": 5, "cache_read": 1}},
            "tools": {"<script>t</script>": {"calls": 1, "errors": 0, "result_chars": 4}},
            "identical_repeats": 0,
            "tool_errors": 0,
            "daily": {},
        }
        page = agent_usage.dashboard(data)
        self.assertNotIn("<img src=x>", page)
        self.assertNotIn("<script>t</script>", page)
        self.assertIn("&lt;img src=x&gt;", page)
        self.assertIn("&lt;script&gt;t&lt;/script&gt;", page)


if __name__ == "__main__":
    sys.exit(unittest.main())
