#!/usr/bin/env python3
"""Agent usage from Claude Code session logs (~/.claude/projects/<slug>/*.jsonl).

Prints the German "Agent-Bilanz" section for a PR (default) or, with --json, the raw
numbers for the dashboard. Host Python 3 only, no dependencies. Limits: a PR maps to a
time window (--since/--until), not to exact turns; a session file can span days when it is
continued, and current Claude Code keeps sub-agent transcripts outside this folder, so
"sessions" counts the files here; token cost of a single tool cannot be isolated -
the result size below is the honest proxy for what eats context.
"""
from __future__ import annotations

import argparse
import html
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path


def parse_when(value: str) -> datetime:
    when = datetime.fromisoformat(value)
    return when if when.tzinfo else when.replace(tzinfo=timezone.utc)


def result_chars(content: object) -> int:
    if isinstance(content, str):
        return len(content)
    if isinstance(content, list):
        return sum(len(part.get("text", "")) for part in content if isinstance(part, dict))
    return 0


class Collector:
    """Aggregates one log row at a time; each method stays simple (Sonar S3776)."""

    def __init__(self) -> None:
        self.tokens: dict[str, Counter] = defaultdict(Counter)
        self.tools: dict[str, Counter] = defaultdict(Counter)
        self.daily: dict[str, Counter] = defaultdict(Counter)
        self.sessions: set[str] = set()
        self.turns = 0
        self.repeats = self.errors = 0
        self.first: datetime | None = None
        self.last: datetime | None = None
        self._last_call: dict[str, tuple[str, str]] = {}  # session -> (name, input json)
        self._call_names: dict[str, str] = {}  # tool_use id -> name

    def feed(self, row: dict, session: str, when: datetime) -> None:
        self.first = min(self.first or when, when)
        self.last = max(self.last or when, when)
        message = row.get("message")
        if not isinstance(message, dict):
            return
        if row.get("type") == "assistant":
            self._usage(message, session, when)
            self._calls(message.get("content"), session)
        elif row.get("type") == "user":
            self._results(message.get("content"), when)

    def _usage(self, message: dict, session: str, when: datetime) -> None:
        usage = message.get("usage")
        model = str(message.get("model", "?"))
        if not isinstance(usage, dict) or model == "<synthetic>":
            return
        self.sessions.add(session)
        self.turns += 1
        bucket = self.tokens[model]
        bucket["fresh"] += usage.get("input_tokens", 0) or 0
        bucket["cache_read"] += usage.get("cache_read_input_tokens", 0) or 0
        bucket["cache_write"] += usage.get("cache_creation_input_tokens", 0) or 0
        out = usage.get("output_tokens", 0) or 0
        bucket["out"] += out
        details = usage.get("output_tokens_details") or {}
        bucket["thinking"] += details.get("thinking_tokens", 0) or 0
        day = self.daily[when.date().isoformat()]
        day["out"] += out
        day["turns"] += 1

    def _calls(self, content: object, session: str) -> None:
        if not isinstance(content, list):
            return
        for part in content:
            if not (isinstance(part, dict) and part.get("type") == "tool_use"):
                continue
            name = str(part.get("name", "?"))
            self._call_names[str(part.get("id"))] = name
            self.tools[name]["calls"] += 1
            key = (name, json.dumps(part.get("input"), sort_keys=True, default=str))
            if self._last_call.get(session) == key:
                self.repeats += 1
                self.tools[name]["repeats"] += 1
            self._last_call[session] = key

    def _results(self, content: object, when: datetime) -> None:
        if not isinstance(content, list):
            return
        for part in content:
            if not (isinstance(part, dict) and part.get("type") == "tool_result"):
                continue
            name = self._call_names.get(str(part.get("tool_use_id")), "?")
            self.tools[name]["result_chars"] += result_chars(part.get("content"))
            if part.get("is_error"):
                self.errors += 1
                self.tools[name]["errors"] += 1
                self.daily[when.date().isoformat()]["errors"] += 1

    def data(self) -> dict:
        return {
            "window": [
                self.first.isoformat() if self.first else None,
                self.last.isoformat() if self.last else None,
            ],
            "sessions": len(self.sessions),
            "turns": self.turns,
            "tokens": {model: dict(counter) for model, counter in self.tokens.items()},
            "tools": {name: dict(counter) for name, counter in self.tools.items()},
            "identical_repeats": self.repeats,
            "tool_errors": self.errors,
            "daily": {day: dict(counter) for day, counter in sorted(self.daily.items())},
        }


def row_time(line: str) -> tuple[dict, datetime] | None:
    """The parsed row and its timestamp, or None for anything unusable."""
    try:
        row = json.loads(line)
    except json.JSONDecodeError:
        return None
    stamp = row.get("timestamp")
    if not isinstance(stamp, str):
        return None
    try:
        return row, parse_when(stamp)
    except ValueError:
        return None


def collect(folder: Path, since: datetime | None, until: datetime | None) -> dict:
    collector = Collector()
    for path in sorted(folder.glob("*.jsonl")):
        for line in path.open(encoding="utf-8", errors="replace"):
            parsed = row_time(line)
            if parsed is None:
                continue
            row, when = parsed
            if (since and when < since) or (until and when > until):
                continue
            collector.feed(row, path.stem, when)
    return collector.data()


def dashboard(data: dict) -> str:
    """The dashboard as a static page in the app's colour tokens (no scripts)."""
    models_rows = []
    max_out = max((b.get("out", 0) for b in data["tokens"].values()), default=1) or 1
    for model, b in sorted(data["tokens"].items(), key=lambda kv: -kv[1].get("out", 0)):
        width = max(2, round(100 * b.get("out", 0) / max_out))
        models_rows.append(
            f'<div class="row"><span class="name">{html.escape(model)}</span>'
            f'<span class="bar"><i style="width:{width}%"></i></span>'
            f'<span class="num">{fmt(b.get("out", 0))} aus · {fmt(b.get("cache_read", 0))} Cache</span></div>')
    days = data.get("daily", {})
    max_day = max((d.get("out", 0) for d in days.values()), default=1) or 1
    day_cols = []
    for day, d in days.items():
        height = max(3, round(100 * d.get("out", 0) / max_day))
        err = f'<b>{d.get("errors", 0)}</b>' if d.get("errors") else "<b>·</b>"
        day_cols.append(f'<div class="col" title="{day}: {fmt(d.get("out", 0))} Ausgabe-Token, '
                        f'{d.get("turns", 0)} Züge"><i style="height:{height}%"></i>{err}'
                        f'<span>{day[5:]}</span></div>')
    tool_rows = []
    for name, c in sorted(data["tools"].items(), key=lambda kv: -kv[1].get("result_chars", 0))[:10]:
        calls = c.get("calls", 0)
        share = 100 * c.get("errors", 0) / calls if calls else 0
        tool_rows.append(f'<tr><td>{html.escape(name)}</td><td>{calls}</td><td>{share:.0f} %</td>'
                         f'<td>{fmt(c.get("result_chars", 0) / 4)}</td></tr>')
    win = data.get("window") or [None, None]
    return f"""<title>Agenten-Bilanz</title>
<style>
:root{{--ground:#f8f3f0;--surface:#ffffff;--ink:#130032;--muted:#5a4e77;--faint:#6b5f86;
--line:#cbc2ff;--lilac:#ede5ff;--action:#4000cc;--false:#c8102e;
--font:'Plus Jakarta Sans',system-ui,sans-serif}}
@media (prefers-color-scheme: dark){{:root:not([data-theme="light"]){{--ground:#130032;--surface:#26065d;
--ink:#f3eeff;--muted:#b8add9;--faint:#9c90c7;--line:#4a2a8a;--lilac:#2f1466;--action:#cbc2ff;
--false:#ffb3b3;color-scheme:dark}}}}
:root[data-theme="dark"]{{--ground:#130032;--surface:#26065d;--ink:#f3eeff;--muted:#b8add9;
--faint:#9c90c7;--line:#4a2a8a;--lilac:#2f1466;--action:#cbc2ff;--false:#ffb3b3;color-scheme:dark}}
body{{background:var(--ground);color:var(--ink);font-family:var(--font);margin:0}}
.wrap{{max-width:860px;margin:0 auto;padding:28px 16px 44px;display:flex;flex-direction:column;gap:22px}}
h1{{margin:0;font-size:26px;font-weight:800;letter-spacing:-.02em}}
p.sub{{margin:0;color:var(--muted)}}
section{{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:16px;min-width:0}}
h2{{margin:0 0 12px;font-size:16px;font-weight:800}}
.row{{display:flex;align-items:center;gap:10px;margin:7px 0;min-width:0}}
.row .name{{flex:0 0 150px;font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis}}
.row .bar{{flex:1;height:10px;background:var(--lilac);border-radius:99px;overflow:hidden}}
.row .bar i{{display:block;height:100%;background:var(--action);border-radius:99px}}
.row .num{{flex:0 0 auto;font-size:12px;color:var(--faint);font-variant-numeric:tabular-nums}}
.chart{{display:flex;gap:6px;align-items:flex-end;height:120px}}
.col{{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:3px;min-width:0}}
.col i{{display:block;width:70%;background:var(--action);border-radius:5px 5px 0 0}}
.col b{{font-size:10px;color:var(--false)}}
.col span{{font-size:10px;color:var(--faint)}}
table{{width:100%;border-collapse:collapse;font-size:13.5px}}
td,th{{text-align:right;padding:5px 8px;border-top:1px solid var(--line);font-variant-numeric:tabular-nums}}
td:first-child,th:first-child{{text-align:left}}
th{{color:var(--faint);font-weight:700;border-top:0}}
footer{{color:var(--faint);font-size:12.5px;line-height:1.5}}
</style>
<div class="wrap">
<h1>Agenten-Bilanz</h1>
<p class="sub">{data["sessions"]} Sitzungsdateien · {fmt(data["turns"])} Züge · {(win[0] or "?")[:10]} → {(win[1] or "?")[:10]}</p>
<section><h2>Ausgabe-Token je Modell</h2>{"".join(models_rows)}</section>
<section><h2>Ausgabe-Token je Tag <small style="color:var(--false);font-weight:600">(rote Zahl: Werkzeugfehler)</small></h2>
<div class="chart">{"".join(day_cols)}</div></section>
<section><h2>Werkzeuge – was den Kontext füllt</h2>
<table><tr><th>Werkzeug</th><th>Aufrufe</th><th>Fehler</th><th>&#8776; Token Ergebnis</th></tr>{"".join(tool_rows)}</table></section>
<footer>Quelle: Claude-Code-Sitzungsprotokolle, erzeugt mit <code>scripts/agent-usage.py --html</code>.
Grenzen: Token je Werkzeug sind eine N&auml;herung (Ergebnisgr&ouml;&szlig;e/4); ein PR entspricht einem
Zeitfenster, nicht exakt einzelnen Z&uuml;gen; identische Direktwiederholungen: {data["identical_repeats"]},
Werkzeugfehler gesamt: {data["tool_errors"]}.</footer>
</div>"""


def project_slug(path: Path) -> str:
    """Claude Code's folder name for a project: the absolute path with '/' and '.' as '-'."""
    return re.sub(r"[/.]", "-", str(path))


def resolve_project(base: Path, project: str) -> Path:
    """The project's folder, required to be a direct child of `base` (Sonar S8707): a crafted
    slug (`..`, absolute, nested, a symlink pointing outside) must not read elsewhere."""
    resolved_base = base.resolve()
    folder = (resolved_base / project).resolve()
    if folder.parent != resolved_base or not folder.is_dir():
        raise ValueError(f"not a project folder under {resolved_base}: {project}")
    return folder


def fmt(number: float) -> str:
    return f"{number:,.0f}".replace(",", " ")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", default=None,
                        help="project folder under ~/.claude/projects (default: this directory's slug)")
    parser.add_argument("--since", type=parse_when, default=None)
    parser.add_argument("--until", type=parse_when, default=None)
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--html", type=Path, default=None,
                        help="also write the dashboard page to this file")
    args = parser.parse_args()

    project = args.project if args.project is not None else project_slug(Path.cwd().resolve())
    try:
        folder = resolve_project(Path.home() / ".claude" / "projects", project)
    except ValueError as error:
        sys.exit(str(error))
    data = collect(folder, args.since, args.until)
    if args.html:
        args.html.write_text(dashboard(data), encoding="utf-8")
    if args.json:
        json.dump(data, sys.stdout, indent=2)
        return

    print(f"**Agent-Bilanz** ({data['sessions']} Sitzungen, {data['turns']} Züge, "
          f"{(data['window'][0] or '?')[:10]} → {(data['window'][1] or '?')[:10]})\n")
    print("| Modell | frisch | Cache gelesen | Cache geschrieben | Ausgabe | davon Denken |")
    print("|---|---:|---:|---:|---:|---:|")
    for model, bucket in sorted(data["tokens"].items()):
        print(f"| {model} | {fmt(bucket.get('fresh', 0))} | {fmt(bucket.get('cache_read', 0))} "
              f"| {fmt(bucket.get('cache_write', 0))} | {fmt(bucket.get('out', 0))} "
              f"| {fmt(bucket.get('thinking', 0))} |")
    top = sorted(data["tools"].items(), key=lambda item: -item[1].get("calls", 0))[:6]
    parts = []
    for name, counter in top:
        calls = counter.get("calls", 0)
        error_share = 100 * counter.get("errors", 0) / calls if calls else 0
        parts.append(f"{name} {calls} ({error_share:.0f} % Fehler, "
                     f"~{fmt(counter.get('result_chars', 0) / 4)} Tok. Ergebnis)")
    print(f"\nWerkzeuge: {' · '.join(parts)}")
    print(f"Identische Wiederholungen direkt nacheinander: {data['identical_repeats']} · "
          f"Werkzeugfehler gesamt: {data['tool_errors']}")


if __name__ == "__main__":
    main()
