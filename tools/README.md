# tools/

Verification suite for `metar-tutorial_3.html`. Run these after **every** change
— they caught several real regressions during development, including two that
static analysis alone would have missed.

Requires Python 3 and Node (any recent version). No packages to install.

All scripts resolve the HTML relative to their own location, so the project
folder can be moved or renamed. Override with the `METAR_HTML` env var if you
need to point at a different copy.

---

## 1. Static checks — run these always

```bash
python tools/check.py
```

Exits non-zero on failure. Runs eight checks:

| Script | What it catches |
|---|---|
| `extract.py` | Pulls the `<script>` block into `extracted.js`; also scans the HTML for **duplicate IDs** |
| `node --check extracted.js` | JS syntax errors |
| `validate.js` | Scenario `factors`/`drivers`/`mitigations`/`sop` ids that don't exist in their choice lists; exam `answer` indexes out of range; scenarios still carrying removed fields; **`${...}` placeholders sitting in single-quoted strings** (they render literally to the student) |
| `regress.js` | Every Go/No-Go scenario's hand-authored verdict vs what `reportedMinimumsStatus()` actually computes from its METAR, and vs `CLASS_SOP`. Catches a scenario whose prose and data have drifted apart |
| `regress_wc.js` | Same for the six What Changed pairs; also checks pair ids are unique |
| `regress_examgen.js` | Generates 4,000 exam items from `EXAM_GEN`, re-derives every answer with an independent parser written inside the script, and requires them to match. Also enforces the doctrine an arithmetic check cannot see: no legality verdicts, the 2,000 ft horizontal obligation restated alongside every altitude answer, the site-verification caveat on every visibility item, and `cat` staying inside the written bank's categories |
| `regress_concepts.js` | The `CONCEPTS` routing table against the exam categories it must match and the anchors it must reach. All three of its failure modes are silent at runtime |
| `refcheck.js` | Every `getElementById` / `querySelector('#…')` resolves to a real element; flags orphaned IDs |

Run individually from inside `tools/` if you want the full output:

```bash
cd tools && node regress.js
```

---

## 2. Browser checks — run these before calling anything done

Static checks verify data and references. These exercise the page the way a
student does. **They need a live page served over HTTP** — `localStorage` is
disabled in `file://` and `data:` contexts, so persistence cannot be tested
there and the page will appear to lose all progress.

```bash
cd <project root>            # the folder containing metar-tutorial_3.html
python -m http.server 8730 --bind 127.0.0.1
```

Open `http://127.0.0.1:8730/metar-tutorial_3.html`, then paste each file into
the devtools console (or hand it to a browser-automation JavaScript tool).

### `browser-regression.js`

Full runtime sweep: every module renders, the parser fixes hold, the dashboard
empty state behaves, the Go/No-Go six-step sequence reveals in order, ordering
and tabs and walkthrough autoplay work, accessibility is intact, print isolates
the cheat sheet, no horizontal overflow, nothing steals focus on load.

Key assertions — treat a change in any of these as a regression:

- `modules.coldReadTokens` **must be 0** (the final walkthrough is deliberately scaffold-free)
- `gng.fullChecklistsInSection` **must be 1** (the seven site checks appear once, not once per card)
- `a11y.unlabelledControls` **must be 0**
- `printSurvivors` **must be `['cheatsheet']`**
- `horizontalOverflow` **must be false**; `landsAtTop` **must be true**
- `runtimeErrors` **must be `[]`**
- `sectionNumbers` **must be `01,…,12` in order**
- `nextAction.hiddenForFreshVisitor` **must be true** — the recommendation panel
  stays silent when it has nothing to say
- `nextAction.intervalAfterTwoPasses` **must be 4** and `intervalAfterAMiss`
  **must be 1** — the Leitner rule
- `nextAction.scheduleThrew` **must be null** — corrupt schedule data degrades
- `rationale.hiddenOnPageLoad` **must be true** (sampled before the sweep drives
  a scenario, which legitimately reveals it) and `rationale.modelLength` **must
  be > 80** — the model answer is composed from scenario data, and the first
  version of it rendered empty by reaching across a closure boundary

### `browser-cloud-fuzz.js`

The strongest check in the project. For each of 2,000 generated cloud-clearance
questions it rebuilds a synthetic METAR from the sky groups on screen, runs it
through the page's **own** `parseMETAR()` to find the lowest layer independently,
computes the answer straight from 14 CFR 107.51, and requires the drill to accept
it. Two independent implementations agreeing across thousands of random cases is
a far stronger statement than either passing its own tests.

**Expect `mismatches: 0`.** Anything else means the drill or the parser has
regressed; `firstFailures` tells you which. Also verifies structural invariants:
layers ascending, never a layer above an overcast, answers within 0–400 ft.

Drop `N` to ~300 for a quick smoke test.

### `browser-exam-fuzz.js`

The complement to `regress_examgen.js`. That script re-derives answers with its
own parser; this one runs 2,000 generated reports through the page's **own**
`parseMETAR()` and `reportedMinimumsStatus()`, which the node tool cannot reach.
Two things only the browser can prove:

- **Every generated report is one the rest of the page can read.** If a template
  ever emitted a group `parseMETAR()` does not recognise, Exam Mode would still
  look fine while the same string pasted into the Decoder came back as
  "Unknown / Unparsed". Part A fails on any leftover token.
- **The exam and the Decoder agree about the same report.** A generated
  visibility item calling the minimum MET while `reportedMinimumsStatus()` flags
  visibility on the same METAR would hand a student two opposite answers on one
  page.

Part B then drives the exam UI as a student does — three full practice runs,
clicking through all ten questions — and checks the draw really is
unmemorisable.

**Expect `mismatches: 0`, `uiProblems: []`, `generatedPerRun: [4, 4, 4]`, and
`distinctGeneratedAcrossRuns: 12`** (four fresh items per run, none repeating).

### `render-check.js` — rendered output, run from the command line

Not a console-paste script: it launches headless Edge or Chrome itself over the
DevTools Protocol (Node's built-in `WebSocket`, nothing to install) and needs
the same local server running.

```bash
node tools/render-check.js
```

Settles two things no static check can:

- **Print.** `browser-regression.js` infers print isolation by reading the
  `@media print` rules and asking which top-level elements no rule hides. This
  puts the page into print media and asks the **layout** which elements still
  occupy space — a rule can be overridden, a box cannot lie — then prints to
  PDF. Writes `render-out/print.pdf` and `render-out/print-preview.png`.
- **Generated exam item layout.** Drives Exam Mode to a generated question and
  captures the card at 1280px and at 390px phone width, so the wrapping of the
  longer generated stems can actually be looked at. Also scans for any element
  in `#exam` wider than the viewport.
- **The two newest panels.** Captures the dashboard's next-action recommendation
  (seeded with a weak category, since it is correctly invisible without history)
  and the free-response rationale panel with its rubric open.

Assertions: `printLayout.inked` **must be `['cheatsheet']`**, and both
`pageOverflow` values **must be false**. Exits non-zero otherwise.

`render-out/` is regenerated output, not source — same status as
`extracted.js`.

Note it measures the box immediately before each capture. The live-report
section swaps in its offline fallback after load and reflows everything below
it, so a box measured earlier points at the wrong part of the page; and the
page scrolls smoothly, so scrolling a section into view and shooting the
viewport races the animation. Clipping to a freshly measured box avoids both.

### Expected console noise

Two `aviationweather.gov` CORS errors per page load are **expected** — that host
sends no `Access-Control-Allow-Origin` header, so the offline fallback engaging
is correct behaviour. Any *other* console error is a real bug.

---

## 3. Editing the HTML — `patchlib.py`

The file is ~4,200 dense lines. Blind `sed` is how you corrupt it. Use
exact-match replacement with assertions:

```python
import sys
sys.path.insert(0, r"<project>/tools")
from patchlib import Patcher
p = Patcher()
p.sub("""<exact existing text>""", """<replacement>""", label="what this does")
p.done()   # writes ONLY if every sub() matched exactly once
```

`sub()` aborts if the old text isn't found exactly `count` times, so a stale
assumption fails loudly instead of silently corrupting the file. Nothing touches
disk until `done()`.

### Gotchas that will cost you time

- **The HTML uses literal Unicode punctuation** — `—` (U+2014), `·` (U+00B7),
  `§` (U+00A7), `°` (U+00B0) — not HTML entities. Match the real characters.
- **Write patch scripts with a file-write tool, not a bash heredoc.** Heredocs
  eat backslashes: `\\u2014` silently becomes `\u2014`, then a real em dash,
  corrupting both your search pattern and your replacement. This bites every
  time; it bit twice during development.
- **`${...}` only interpolates inside backticks.** Several data arrays use
  single-quoted strings — putting `${CLASS_SOP.name}` in one renders the literal
  text to the student. `validate.js` catches this.
- **In-memory state survives `localStorage.clear()`** during a session. Reload
  before testing fresh-visitor behaviour or you will misread the result.

---

## 4. Files

| File | |
|---|---|
| `check.py` | Runs all static checks; exits non-zero on failure |
| `extract.py` | JS extraction + duplicate-ID scan |
| `validate.js` `regress.js` `regress_wc.js` `regress_examgen.js` `refcheck.js` | Static checkers |
| `browser-regression.js` `browser-cloud-fuzz.js` `browser-exam-fuzz.js` | Console-paste browser checks |
| `render-check.js` | Headless render: print output + generated-item layout |
| `patchlib.py` | Safe exact-match editing helper |
| `extracted.js` | Build artifact, regenerated by `extract.py`. Not source |
| `render-out/` | Build artifact, regenerated by `render-check.js`. Not source |
