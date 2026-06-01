#!/usr/bin/env python3
"""cleanmax bloat-budget gate — deterministic anti-bloat check on a git diff.

No LLM, no network. Flags three structural bloat signals on a change:
  1. net LOC added over a budget (added - deleted),
  2. too many NEW files (prefer editing existing files),
  3. REINVENTED symbols — a newly added def/function/class/const whose name
     already exists elsewhere in the repo (duplication is the most actionable
     bloat signal).

Exit 2 = over budget (gate fail; stderr explains). Exit 0 = within budget.
Pairs with /simplify (which fixes) — this measures and gates.

Usage:
  bloat_budget.py [--base REF] [--staged] [--max-net-loc N] [--max-new-files N] [--no-dups]
  bloat_budget.py --selftest
"""
from __future__ import annotations

import argparse
import pathlib
import re
import subprocess
import sys

_DEF = re.compile(r'^\+\s*(?:export\s+)?(?:async\s+)?(?:def|function|class)\s+([A-Za-z_][A-Za-z0-9_]*)')
_ASSIGN = re.compile(r'^\+\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=')
_SKIP = ('/.git/', '/node_modules/', '/dist/', '/build/', '/.venv/', '/__pycache__/')


def added_symbols(diff_text: str) -> list[str]:
    """Symbol names introduced on added (+) lines of a unified diff."""
    out = []
    for line in diff_text.splitlines():
        if not line.startswith('+') or line.startswith('+++'):
            continue
        m = _DEF.match(line) or _ASSIGN.match(line)
        if m:
            out.append(m.group(1))
    return out


def net_loc(numstat_text: str) -> tuple[int, int]:
    """(added, deleted) summed over a `git diff --numstat` output."""
    add = dele = 0
    for line in numstat_text.splitlines():
        parts = line.split('\t')
        if len(parts) >= 2 and parts[0].isdigit() and parts[1].isdigit():
            add += int(parts[0])
            dele += int(parts[1])
    return add, dele


def reinvented(symbols, repo_root, changed_paths) -> dict[str, str]:
    """Map symbol -> existing file where it's already defined (outside the diff)."""
    dups: dict[str, str] = {}
    changed = set(changed_paths)
    root = pathlib.Path(repo_root)
    for name in sorted(set(symbols)):
        pat = re.compile(r'(?:def|function|class|const|let|var)\s+' + re.escape(name) + r'\b')
        for p in root.rglob('*'):
            if not p.is_file() or any(s in f'/{p}/' for s in _SKIP):
                continue
            rel = str(p.relative_to(root))
            if rel in changed:
                continue
            try:
                if pat.search(p.read_text(errors='ignore')):
                    dups[name] = rel
                    break
            except Exception:
                continue
    return dups


def _git(args, cwd='.'):
    return subprocess.run(['git', *args], cwd=cwd, capture_output=True, text=True).stdout


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog='bloat_budget')
    ap.add_argument('--base', default='HEAD')
    ap.add_argument('--staged', action='store_true')
    ap.add_argument('--max-net-loc', type=int, default=400)
    ap.add_argument('--max-new-files', type=int, default=3)
    ap.add_argument('--no-dups', action='store_true', help='do not gate on reinvented symbols')
    ap.add_argument('--selftest', action='store_true')
    a = ap.parse_args(argv)
    if a.selftest:
        return _selftest()

    diff_args = ['diff', '--cached'] if a.staged else ['diff', a.base]
    diff_text = _git([*diff_args])
    numstat = _git([*diff_args, '--numstat'])
    changed = [l for l in _git([*diff_args, '--name-only']).splitlines() if l]
    new_files = [l for l in _git([*diff_args, '--name-only', '--diff-filter=A']).splitlines() if l]

    add, dele = net_loc(numstat)
    net = add - dele
    dups = {} if a.no_dups else reinvented(added_symbols(diff_text), '.', changed)

    print(f"net LOC: +{add} -{dele} = {net:+d} (budget {a.max_net_loc})")
    print(f"new files: {len(new_files)} (budget {a.max_new_files})" + (f" -> {new_files}" if new_files else ""))
    if dups:
        for n, where in dups.items():
            print(f"reinvented: `{n}` already defined in {where} — reuse it, don't re-add")

    fails = []
    if net > a.max_net_loc:
        fails.append(f"net LOC {net} > {a.max_net_loc}")
    if len(new_files) > a.max_new_files:
        fails.append(f"new files {len(new_files)} > {a.max_new_files}")
    if dups:
        fails.append(f"{len(dups)} reinvented symbol(s)")
    if fails:
        print("BLOAT GATE FAIL: " + "; ".join(fails), file=sys.stderr)
        return 2
    print("BLOAT GATE PASS")
    return 0


def _selftest() -> int:
    assert added_symbols("+def foo():\n+const bar = 1\n+++ junk\n unchanged\n+class Baz:") == ["foo", "bar", "Baz"]
    assert net_loc("12\t3\tfile.py\n0\t0\tx\n5\t1\ty") == (17, 4)
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        (pathlib.Path(d) / "existing.py").write_text("def helper():\n    return 1\n")
        dups = reinvented(["helper", "brand_new"], d, ["new.py"])
        assert dups == {"helper": "existing.py"}, dups
    print("selftest OK: symbol-extract, net-loc, reinvented-detection")
    return 0


if __name__ == "__main__":
    sys.exit(main())
