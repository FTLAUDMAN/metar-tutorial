# METAR Flight Briefing Trainer — BWHS Wolverines UAS

A single self-contained web page that teaches students to read a METAR (the
coded weather report pilots check before every flight) and turn it into a
go/no-go decision they can defend, in preparation for the FAA Part 107 Remote
Pilot knowledge test.

**Start here.** Pick the section below that matches what you want to do.

---

## A. I just want to use it in class

**Double-click `metar-tutorial_3.html`.** That's the whole install.

It opens in any modern browser (Chrome, Edge, Firefox, Safari) and works with no
internet connection, no server, and nothing to set up. The school logo, all the
weather data, the drills and the quizzes are inside that one file.

Three things worth knowing:

- **Student progress is saved per-browser, per-computer.** It does not follow a
  student to another machine, and it is never sent anywhere. There is a "Clear
  all my data" button on the page.
- **Opened directly from disk, the page runs in offline mode.** It shows a
  practice METAR instead of live weather. This is expected and everything still
  works — see section D if you want live data.
- **Printing gives you the cheat sheet only.** Ctrl/Cmd+P produces a clean
  multi-page kneeboard reference, not the whole tutorial.

To hand it to students, copy that one file. Email it, drop it on a shared drive,
or put it on the school network — it has no dependencies.

---

## B. I want to check it survived the move

From this folder:

```bash
python tools/check.py
```

Expect eight `ok` lines and `All static checks passed.` If Python or Node are
missing, see section C.

You can also confirm the files transferred intact:

```bash
# macOS / Linux
shasum -a 256 -c CHECKSUMS.txt

# Windows PowerShell
Get-FileHash -Algorithm SHA256 metar-tutorial_3.html
# compare against the value in CHECKSUMS.txt
```

---

## C. I want to edit or extend it

### Prerequisites

| | Why | Get it |
|---|---|---|
| **Python 3** | Runs the checkers and the local test server | python.org/downloads — tick **"Add Python to PATH"** during install |
| **Node.js** | Runs the JavaScript validators | nodejs.org — LTS build is fine |

Nothing else. No `npm install`, no virtualenv, no build step. Verify with:

```bash
python --version     # or python3 --version
node --version
```

### Then read, in this order

1. **`HANDOFF.md`** — written for whoever picks this up next, assuming no prior
   context. Its section 2 ("Editorial doctrine") lists ten distinctions the
   whole page is built around; breaking one of those is the easiest way to do
   real damage. Section 5 lists the remaining work in priority order.
2. **`tools/README.md`** — how to verify changes, and four gotchas that will
   otherwise cost you an hour each.

### The one rule

**Run `python tools/check.py` after every change.** It exits non-zero on
failure and it catches things that reading the diff does not.

---

## D. I want live weather data

The page tries to fetch a current observation from `aviationweather.gov`. That
service sends no CORS header, so **the browser blocks the request** whether the
file is opened from disk or served locally. The page detects this and falls back
to a practice METAR — which is correct behaviour, not a bug.

Two console errors per page load mentioning `aviationweather.gov` are expected.

If you want live data in class, the reliable route is the **Decode** tab: copy a
current METAR from <https://aviationweather.gov/data/metar/> and paste it in.
The decoder is fully offline and handles US and international formats.

---

## E. What's in this folder

```
metar-tutorial_3.html     The deliverable. This is the thing students use.
README.md                 You are here.
HANDOFF.md                Full context for the next developer or AI session.
tools/                    Verification suite (see tools/README.md)
reference/
  metar-tutorial_2.html   Pre-revision baseline, kept for provenance/diffing.
                          Do not overwrite or ship this one.
CHECKSUMS.txt             SHA-256 of every shipped file.
```

`tools/extracted.js` is not shipped — it is a build artifact that
`tools/check.py` regenerates on first run.

---

## F. Regulatory note

Regulatory references are to 14 CFR Part 107 and are for classroom use only.
Part 107 is amended from time to time; check the current text at
<https://www.ecfr.gov/current/title-14/chapter-I/subchapter-F/part-107> before
relying on anything here.

The operating limits shown in the trainer (wind, gusts, precipitation,
hot-weather thresholds) are **classroom training limits written for this
course**. They are not manufacturer specifications and not FAA rules. Part 107
sets no maximum wind speed and no thunderstorm prohibition. A real aircraft's
limits come from its own documentation.

Nothing on the page authorizes a flight. The Remote Pilot in Command makes that
call.
