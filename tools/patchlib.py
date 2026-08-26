import io, sys, os
import os as _os
TARGET = _os.environ.get("METAR_HTML") or _os.path.join(
    _os.path.dirname(_os.path.abspath(__file__)), "..", "metar-tutorial_3.html")

def read():
    with io.open(TARGET, 'r', encoding='utf-8', newline='') as f:
        return f.read()

def write(s):
    with io.open(TARGET, 'w', encoding='utf-8', newline='') as f:
        f.write(s)

class Patcher:
    def __init__(self):
        self.s = read()
        self.n = 0
    def sub(self, old, new, count=1, label=''):
        found = self.s.count(old)
        if found != count:
            raise SystemExit("PATCH FAIL [%s]: expected %d occurrence(s), found %d\n---OLD---\n%s\n" % (label or ('#%d'%self.n), count, found, old[:400]))
        self.s = self.s.replace(old, new)
        self.n += 1
        print("  ok  %s" % (label or ('#%d'%self.n)))
    def done(self):
        write(self.s)
        print("Applied %d patches." % self.n)
