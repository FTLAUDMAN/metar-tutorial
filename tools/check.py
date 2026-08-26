# -*- coding: utf-8 -*-
"""Run every static check in one go.

    python tools/check.py

Exits non-zero if anything fails, so it can gate a commit. The browser checks
(browser-regression.js, browser-cloud-fuzz.js) are NOT run here -- they need a
live page; see tools/README.md.
"""
import os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
TARGET = os.environ.get("METAR_HTML") or os.path.join(HERE, "..", "metar-tutorial_3.html")

STEPS = [
    ("extract JS + duplicate-id scan", [sys.executable, "extract.py"]),
    ("JS syntax",                      ["node", "--check", "extracted.js"]),
    ("data tables",                    ["node", "validate.js"]),
    ("Go/No-Go scenarios",             ["node", "regress.js"]),
    ("What Changed pairs",             ["node", "regress_wc.js"]),
    ("generated exam items",           ["node", "regress_examgen.js"]),
    ("concept routing",                ["node", "regress_concepts.js"]),
    ("element references",             ["node", "refcheck.js"]),
]

def main():
    if not os.path.exists(TARGET):
        print("FAIL: target not found: %s" % TARGET)
        return 1
    print("target: %s\n" % os.path.normpath(TARGET))
    failed = []
    for name, cmd in STEPS:
        try:
            r = subprocess.run(cmd, cwd=HERE, capture_output=True, text=True)
        except FileNotFoundError as e:
            print("  SKIP  %-32s (%s not installed)" % (name, cmd[0]))
            failed.append(name)
            continue
        ok = r.returncode == 0
        print("  %-5s %s" % ("ok" if ok else "FAIL", name))
        if not ok:
            failed.append(name)
            out = (r.stdout or "") + (r.stderr or "")
            print("\n".join("        " + l for l in out.strip().splitlines()[-25:]))
    print()
    if failed:
        print("FAILED: " + ", ".join(failed))
        return 1
    print("All static checks passed.")
    print("Browser checks are separate -- see tools/README.md section 2.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
