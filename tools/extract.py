import io, re, sys
import os as _os
TARGET = _os.environ.get("METAR_HTML") or _os.path.join(
    _os.path.dirname(_os.path.abspath(__file__)), "..", "metar-tutorial_3.html")
s = io.open(TARGET, 'r', encoding='utf-8', newline='').read()
i = s.find('<script>')
j = s.rfind('</script>')
js = s[i+len('<script>'):j]
io.open('extracted.js', 'w', encoding='utf-8').write(js)
print('extracted %d bytes of JS' % len(js))
# duplicate id scan
ids = re.findall(r'\sid="([^"]+)"', s[:i])
dupes = {x for x in ids if ids.count(x) > 1}
print('HTML ids:', len(ids), 'duplicates:', sorted(dupes) if dupes else 'none')
