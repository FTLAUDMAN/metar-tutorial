# METAR Tutorial — Handoff

Written for whoever picks this up next. Assume no memory of prior sessions.
Everything you need is in this directory.

---

## 1. What this is

`metar-tutorial_3.html` — a single self-contained HTML page that teaches
Bentonville West High School UAS students to read a METAR (coded aviation
weather observation) and turn it into a defensible go/no-go decision, in
preparation for the FAA Part 107 Remote Pilot knowledge test.

| | |
|---|---|
| **Deliverable** | `metar-tutorial_3.html` (~357 KB, ~5,820 lines) |
| **Distribution copy** | Whatever second location the teacher keeps for students — keep it in sync with this one |
| **Original source** | `reference/metar-tutorial_2.html` — the pre-revision baseline, kept for provenance and diffing. **NEVER overwrite.** MD5 `6746f3b1af4ae52ebbc28b40d0cd315e`, 219,889 bytes |
| **Audience** | High-school students, many first-time |

### Hard constraints (carried from the original brief)

- **One self-contained HTML file.** No framework, no package manager, no build
  step, no server dependency.
- Only permitted external references: the Google Fonts stylesheet, and outbound
  informational links (aviationweather.gov, eCFR, the school site). The school
  logo is an embedded base64 data URI — leave it that way.
- Preserve: responsive layout, keyboard accessibility, `prefers-reduced-motion`
  handling, the colour-blind-safe palette toggle, offline fallback, and the
  print stylesheet that emits **only** the cheat sheet.
- **Never invent manufacturer aircraft specifications.** Any operational limit
  shown to a student must be visibly labelled a classroom/training limit.

---

## 2. Editorial doctrine — read this before touching any prose

The bulk of the prior work was enforcing a set of distinctions that students
(and the original draft) routinely collapsed. **Breaking these is the most
likely way to damage this page.** Every one of them is load-bearing.

1. **"Reported minimums MET" ≠ "legal at your site."** A METAR is an
   observation from an airport. § 107.51(c) is written around the flight
   visibility *you* observe from *your* control station, and (d) around the
   clouds above *your* operating area. The page screens the reported numbers
   and then says, every single time, that site verification is still owed.

2. **Three separate questions, never merged:**
   - *Reported minimums:* **MET** / **NOT MET** (numbers in the report vs § 107.51)
   - *Site verification:* the seven things a METAR structurally cannot tell you
   - *Operational call:* **Operational GO** / **GO with restrictions** / **Operational NO-GO**

   Do not reintroduce the words "Legal"/"Illegal" as a verdict label.

3. **§ 107.49 requires assessment of "local weather conditions."** Not
   "prevailing weather conditions." Do not imply the regulation names METARs or
   TAFs, or requires both. Approved phrasing: *"§ 107.49 requires the remote PIC
   to assess local weather conditions; METARs and TAFs are important tools for
   doing so."* ("Prevailing visibility" is correct and stays — that's the METAR
   term, a different thing.)

4. **Part 107 sets no maximum wind speed** and **no numerical thunderstorm
   prohibition.** Strong wind and thunderstorms are *operational hazards*, never
   numerical-minimum violations. Wind limits come from the aircraft's
   documentation and local policy — here, `CLASS_SOP`.

5. **Cloud-height arithmetic is conditional.** Always
   *"conservative under-cloud planning limit **if this layer represents the
   operating site**"* — never an unconditional legal maximum.

6. **The 2,000 ft horizontal clearance must never be forgotten.** It is an
   independent obligation that altitude cannot satisfy. It gets restated
   alongside every vertical calculation.

7. **Cloud clearance applies to ANY cloud, not the ceiling.** FEW and SCT count.
   This is the single most-tested and most-missed concept on the page.

8. **KXNA is the "Primary Reporting Station," not the "nearest."** ~7 miles
   *south* of campus, field elevation ~1,288 ft MSL. KVBT is geographically
   closer but KXNA is retained because it carries the principal ASOS observation
   and the TAF the page uses. Campus elevation (~1,380 ft) must stay labelled
   approximate; do **not** display a derived elevation difference.

9. **Sky cover is reported on a summation basis.** The amount given for a
   layer is the total sky covered at *and below* it, so coverage can never
   decrease with height: `BKN038 FEW060` is not a report any station
   transmits. Both generators (the Cloud Clearance Drill and `EXAM_GEN`) build
   layers under this rule, and `browser-cloud-fuzz.js`, `regress_examgen.js`
   and `browser-exam-fuzz.js` all assert it. Showing an impossible report
   teaches a convention that does not exist.

10. **`CLASS_SOP` values are classroom training limits.** Never attribute them to
   DJI or any manufacturer. The label appears on every card that shows them.

---

## 3. Architecture

Everything lives in one `<script>` near the bottom. Rough map (line numbers
drift — grep the banner comments instead):

| Module | Purpose |
|---|---|
| `PROGRESS` | localStorage wrapper. All keys prefixed `bwhs_metar_`. `clear()` wipes by prefix, so new keys are covered automatically. |
| `blankGngCumulative` / `loadGngCumulative` / `saveGngCumulative` | Go/No-Go cumulative totals. Merges saved values onto a blank shape — corrupt/old data degrades to zero rather than throwing. |
| `loadWcCumulative` / `loadCloudCumulative` | Same pattern for What Changed and the cloud drill. |
| `CLASS_SOP` | **The single source of truth for every operational limit.** `maxSustainedWindKt: 15`, `maxGustKt: 20`, `precipitationAllowed: false`, `hotWxTempC: 35`. Never hardcode these numbers in prose — interpolate from the object. |
| `SOP_LIMITS` / `sopCardHtml()` | Renders only the constraints relevant to a given scenario. |
| `SITE_VERIFICATION` / `verifyBoxHtml()` / `verifyPromptHtml()` | The seven site checks. Full box for single-instance contexts; compact scenario-specific prompt where it would repeat. |
| `reportedMinimumsStatus(meta)` | The numerical screen. Returns `{status:'met'\|'notmet'\|'unknown', label, pill, fails[]}`. |
| `sopFindings(meta)` | Classroom-profile breaches, kept strictly separate from the regulatory screen. |
| `parseMETAR(raw)` | Returns `{fields[], meta}`. Handles US and ICAO formats, variable RVR, metric visibility, trend groups. |
| `part107Box(meta)` | Three visually separated blocks: reported numbers → operational hazards → classroom SOP, then the verification checklist. |
| `renderMetarSpans()` + `METAR_GROUPS` | Makes every rendered METAR clickable via one delegated listener. |
| `EXAM_BANK` | The 23 hand-written exam items. Conceptual questions live here — the ones a template cannot produce. |
| `CONCEPTS` | The eight things the page teaches, and which surface practises each. `id` must match an exam category string exactly, or that concept can never accumulate accuracy. `regress_concepts.js` enforces both directions. |
| `PROGRESS.recordPractice` / `loadSchedule` / `recommend` | Spaced practice. `catSchedule` holds `{last, interval}` per concept; `recommend()` turns accuracy plus overdue-ness into the dashboard's single instruction, or returns `null` when there is nothing worth saying. |
| `RATIONALE_RUBRIC` / `initRationale` | The free-response panel at the end of the Go/No-Go trainer. Self-scored; nothing is persisted but the tally. The model answer is composed from scenario data. |
| `EXAM_GEN` | Generates exam items from random METARs: 10 templates over the mechanical skills (ceiling, lowest layer, under-cloud arithmetic, visibility screening and decoding, wind, Zulu, temp/dew). `batch(n, catWeights)` returns `n` items shaped exactly like `EXAM_BANK` entries, biased toward weak categories. **Self-contained — it reads nothing else on the page**, which is what lets `regress_examgen.js` pull the literal out and fuzz it. Keep it that way. |

`initExam` reserves `GENERATED = 4` of the ten slots for `EXAM_GEN` items and
fills the rest from the weighted `EXAM_BANK` draw. Generation is wrapped in a
`try` — if a template ever throws, the student loses four questions, not the
exam.

### Persistence keys

`examHistory` / `checkrideHistory` (capped at 60), `examRuns` / `checkrideRuns`
(uncapped true totals — the dashboard reads these, **not** array length),
`examBestPct`, `checkrideBestPct`, `examCatWeights`, `zuluBest`, `cloudBest`,
`cloudCumV1`, `gngCumulativeV2`, `wcCumulativeV2`, `activeDays` (capped 90),
`catSchedule` (per-concept `{last, interval}`), `rationaleCumV1`.

Every cumulative loader merges saved values onto a blank shape, so corrupt or
older data degrades to zero rather than throwing. `loadSchedule()` does the same
for dates: an unparseable interval becomes "due now" rather than an exception.

### Page order (12 numbered sections)

```
masthead → dashboard → hero (unnumbered, "what is a METAR")
01 Current Report (live KXNA + offline fallback)
02 Anatomy         03 Field Order      04 Zulu Time
05 Cloud Clearance Drill               06 Guided Walkthrough
07 What Changed    08 Decoder/Builder/Live   09 METAR vs TAF
10 Go/No-Go Trainer                    11 Exam Mode
12 Cheat Sheet (the only section that prints)
```

The dashboard also carries a **next-action panel** (`#dashNext`), and section 10
ends with the **free-response rationale panel** (`#rationale`). Neither is a
numbered section: the twelve-section order is asserted by
`browser-regression.js` and referenced throughout this file, so new surfaces
belong inside an existing section rather than after section 12.

---

## 4. Verification tooling — `tools/`

**Run the static suite after every change.** It caught several real regressions
during development, including two that reading the diff would not have found.

```bash
python tools/check.py
```

Exits non-zero on failure. Portable — every script resolves the HTML relative to
its own location, so the folder can be moved or renamed (override with the
`METAR_HTML` env var). Requires Python 3 and Node; nothing to install.

| Script | Catches |
|---|---|
| `check.py` | Runner for all eight static checks |
| `extract.py` | Pulls the JS out; scans for **duplicate HTML IDs** |
| `validate.js` | Bad scenario factor/driver/mitigation/SOP ids; out-of-range exam answer indexes; removed fields; **`${...}` stranded in single-quoted strings** (renders literally to students) |
| `regress.js` | Every Go/No-Go scenario's authored verdict vs what `reportedMinimumsStatus()` computes, and vs `CLASS_SOP` — catches prose and data drifting apart |
| `regress_wc.js` | Same for the six What Changed pairs; pair-id uniqueness |
| `regress_concepts.js` | The `CONCEPTS` join: ids that are not exam categories (so accuracy never accrues), hrefs naming no element (so the dashboard's one button goes nowhere), and exam categories with no entry (tracked but never recommended). Every one of those fails silently at runtime |
| `regress_examgen.js` | Generates 4,000 `EXAM_GEN` items and re-derives every answer with an independent parser; also enforces the doctrine an arithmetic check cannot see (no legality verdicts, 2,000 ft horizontal restated, site caveat on visibility items) |
| `refcheck.js` | Dangling `getElementById`/`querySelector('#…')`; orphaned IDs |
| `patchlib.py` | Safe exact-match editing helper (see §7) |
| `render-check.js` | **Command-line, not console-paste.** Launches headless Edge/Chrome over the DevTools Protocol. Verifies print output as rendered layout and as a PDF, and captures the generated exam items at desktop and phone width. Needs a browser binary and the local server, which is why `check.py` does not run it |

### Browser checks — required before calling anything done

Static checks verify data and references. These exercise the page as a student
does, and **must be run over HTTP** — `localStorage` is disabled in `file://`
and `data:` contexts, so persistence silently appears broken there.

```bash
python -m http.server 8730 --bind 127.0.0.1
# open http://127.0.0.1:8730/metar-tutorial_3.html, then paste each file
# into the devtools console (or hand it to a browser-automation JS tool)
```

- **`browser-regression.js`** — full runtime sweep: every module renders, parser
  fixes hold, dashboard empty state behaves, Go/No-Go reveals in order, ordering
  and tabs and autoplay work, a11y intact, print isolated, no overflow, nothing
  steals focus on load. Hard assertions listed in `tools/README.md` §2.
- **`browser-cloud-fuzz.js`** — the strongest check in the project. For each of
  2,000 generated cloud-clearance questions it rebuilds a synthetic METAR from
  the sky groups on screen, runs it through the page's **own** `parseMETAR()` to
  find the lowest layer independently, computes the answer straight from
  14 CFR 107.51, and requires the drill to accept it. Two independent
  implementations agreeing across thousands of random cases. **Expect
  `mismatches: 0`.**

- **`browser-exam-fuzz.js`** — the complement to `regress_examgen.js`. Runs
  2,000 generated reports through the page's **own** `parseMETAR()` and
  `reportedMinimumsStatus()`, so a generated report that the Decoder could not
  read, or an exam answer that contradicts the Decoder on the same METAR, fails
  here. Part B drives three full practice exams through the UI. **Expect
  `mismatches: 0`, `uiProblems: []`, `generatedPerRun: [4, 4, 4]`.**

All three were re-run against the live page over HTTP after this change:
regression sweep all-green (`runtimeErrors: []`, `printSurvivors:
['cheatsheet']`), cloud fuzz 2,000/2,000 with zero mismatches, exam fuzz
2,000 items with zero mismatches.

**Expected console noise:** when the page is opened from `file://`, two
`aviationweather.gov` CORS errors still appear (the proxy does not help with
`file://`). When served over HTTP with the Cloudflare Worker proxy active,
the live fetch succeeds and no CORS errors appear. Any *other* console error
is a real bug.

`tools/README.md` documents all of this in more detail.

---

## 5. Work completed against the original priority list

The five items this file used to list as outstanding, and what was done about
each. Kept rather than deleted: the *problem* statements are the reasoning a
future change should not undo by accident.

### ✓ DONE — The exam bank is no longer memorizable

> **Later fix, adopted from an external review pass.** `EXAM_GEN.mc()` capped
> only the filler list, not the wrongs list, and template distractors can
> collide with the correct answer once random values land (temperature 13 over
> dew point 0 yields a temperature *and* a spread of 13). Measured over 20,000
> items: **5.1% had five choices, 0.14% had three.** `mc()` now caps at four,
> falls back to four generic always-false statements, and throws rather than
> return a malformed item — the throw is caught by `initExam`, which degrades
> to a bank-only draw. `regress_examgen.js` now asserts **exactly four**; the
> earlier "at least three" is what let this through.

Was: 23 questions, draws 10, so roughly 4 of every 10 repeated between
consecutive runs and a student was recalling *this page* rather than the
concept — which the adaptive weighting then scored as rising mastery.

Now: `EXAM_GEN` (10 templates over the mechanical skills) supplies 4 of every
10 questions, built fresh from a random METAR each time. Measured in the
browser over 400 simulated pairs of runs: repeats between consecutive runs went
from **4.4 to 1.6**, and already-seen questions in a student's fifth run from
**9.0 of 10 to 4.2**. The remaining repetition is entirely the hand-written
conceptual bank, which is the half that *should* repeat.

If you extend it: templates live in `EXAM_GEN.templates` as
`{id, cat, build(g)}` returning `{metar, q, choices[], answer, explain}`. Add a
matching re-derivation branch to `regress_examgen.js` — the `default` case
fails on an unknown template id specifically so a new template cannot ship
unverified. `cat` must stay inside the written bank's category names.

---

### ✓ DONE — Confidence data now drives a correction

Was: "sure and wrong" incremented a counter and printed a percentage, and each
scenario's `misconception` fired only on a wrong **reported-minimums** call — so
a student who confidently blew the **operational** call was told nothing at all.

Now: every scenario carries an `opMisconception` alongside `misconception`, and
the step-6 handler picks corrections by **which call went wrong**. When
`conf === 'sure'` and either call was wrong, the correction is promoted out of
the footnote into a `.gng-callout` at the top of the reveal, named as a
misconception rather than a miss. `validate.js` requires both fields on every
scenario, so a new scenario cannot ship with half the feedback.

---

### ✓ DONE — Practice is scheduled

> **Later fix, adopted from an external review pass.** Day keys used
> `toISOString().slice(0,10)` — a **UTC** date. In Arkansas a new day therefore
> began at 6 or 7 p.m. local, so evening practice was logged against tomorrow,
> the streak dots highlighted the wrong day, and `daysBetween` skewed every
> interval below. All day keys now go through `localDateString()`
> (`America/Chicago`). The `const today` inside `recordDay` also shadowed the
> `today()` helper added here and is now `practiceDay`.

Was: `activeDays` and `examCatWeights` were both tracked and neither drove a
due-date.

Now: `PROGRESS.recordPractice(concept, ratio)` maintains `catSchedule` — a
per-concept `{last, interval}`. Leitner in its simplest honest form: pass and
the gap doubles, miss and it resets to one day, capped at 21. It stores **dates
only**; accuracy stays in `examCatWeights`, because mixing them would let one
bad day erase work that is genuinely learned.

Wired into all four practice surfaces. The exam records one entry per category
the run actually touched. The two drills record per batch of five rather than
per question — per-question would let five lucky answers push the next review
out three weeks. Go/No-Go records per scenario, needing both calls right.

---

### ✓ DONE — The dashboard names a next action

Was: "3 scenarios · 5 attempts · 100% on minimums" told a student nothing about
what to do next.

Now: a `#dashNext` panel with one sentence and one button, driven by
`PROGRESS.recommend()`. Priority: weak **and** overdue, then weakest, then most
overdue, then never practised. It routes through the new `CONCEPTS` table, which
maps each concept to the surface where it is best practised — Clouds to the
drill, Time to the Zulu drill, the rest to Exam Mode, whose draw is already
weighted toward weak categories.

`recommend()` returning **null** is a real answer and must stay one: a panel
that always demands something teaches students to ignore it.

---

### ✓ DONE — One production task, not just recognition

Was: every interaction on the page was click-one-of-N.

Now: a free-response panel at the end of the Go/No-Go trainer. The student
writes the call as they would say it to an instructor, then compares against a
four-point rubric they score themselves.

Three deliberate limits, all of them load-bearing:

- **It does not grade the prose.** There is a keyword scan, and it is labelled
  in the interface as "a rough check, not a grade". A scanner cannot tell a good
  rationale from one that name-drops the right words, and pretending otherwise
  would teach students to write for the scanner.
- **It does not save what they wrote.** A text box whose contents persist
  invites treating this as an assignment to complete once rather than a
  rehearsal to repeat.
- **The model answer is composed from the scenario's own fields**, never
  authored per scenario, so it cannot drift from what the six steps just taught.

It lives inside section 10 rather than becoming a thirteenth section, because
the twelve-section order is asserted by `browser-regression.js` and named all
over the documentation.

---

## 6. What is actually left

Nothing on the original list. What remains is judgement calls for the teacher
rather than work items:

- **The live METAR fetch now works when served over HTTP** (localhost, GitHub
  Pages, any web server) via a Cloudflare Worker proxy at
  `https://metar-proxy.josiahlcarlson.workers.dev`. It still cannot work from
  `file://` — browsers block all fetches from that protocol regardless of CORS.
- **The rationale rubric is self-scored.** That is the honest design given no
  server and no grader, but it means the "Rationales written" tile measures
  effort, not quality. Treat it as a prompt for conversation, not as data.
- **Spacing intervals are untested against real student behaviour.** Doubling
  from one day with a 21-day cap is a reasonable default, not a validated one.
  If students report being nagged too often or too rarely, `MAX_INTERVAL_DAYS`
  and the doubling rule are two lines in `PROGRESS`.
- Anything a teacher wants that is not here. The page is complete against the
  brief it was given.

---

## 7. How to make changes safely

The file is large and dense. Blind `sed` is risky. The method that worked:
**Python exact-match replacement scripts with assertions.**

```python
import sys
sys.path.insert(0, r"<project>/tools")   # absolute path to this repo's tools/
from patchlib import Patcher
p = Patcher()
p.sub("""<exact existing text>""", """<replacement>""", label="what this does")
p.done()   # writes only if every sub() matched exactly once
```

`Patcher.sub()` aborts if the old text isn't found exactly `count` times, so a
stale assumption fails loudly instead of silently corrupting the file. Nothing
is written to disk until `done()`.

### Gotchas that cost time

- **The file uses literal Unicode punctuation** (`—` U+2014, `·` U+00B7,
  `§` U+00A7, `°` U+00B0), not HTML entities. Match the real characters.
- **Write patch scripts with the file-write tool, not a bash heredoc.** Heredocs
  mangle backslashes — `\\u2014` silently becomes `\u2014` and then a real em
  dash, corrupting both patterns and replacements.
- **`${...}` only interpolates inside backticks.** Several data arrays use
  single-quoted strings; putting `${CLASS_SOP.name}` in one renders the literal
  text to the student. `validate.js` checks for this.
- **Test persistence over HTTP only** (see §4).
- **In-memory state survives `localStorage.clear()`** during a session — reload
  before testing "fresh visitor" behaviour, or you'll misread the result.

---

## 8. Known limitations

- ~~Live METAR fetch has never been observed succeeding.~~ **Closed.** A
  Cloudflare Worker proxy (`worker/metar-proxy.js`, deployed at
  `https://metar-proxy.josiahlcarlson.workers.dev`) relays requests to
  aviationweather.gov and adds the CORS header. The `METAR_PROXY` constant in
  the tutorial points to it; if the proxy is absent or unreachable, the fetch
  falls back to the direct URL (which will fail on CORS), and the offline
  fallback engages as before. `file://` pages still cannot fetch regardless of
  CORS headers — the `file://` error message remains accurate.
- ~~Print output verified by CSS rule analysis, not a rendered PDF.~~
  **Closed.** `tools/render-check.js` now renders the page in print media and
  checks which elements still occupy space (only `main-content`), and prints to
  PDF — 4 pages, colour coding intact, `break-inside: avoid` keeping cards
  whole across page breaks. Artifacts land in `tools/render-out/`.
- **Mojibake is invisible to every checker here.** Two `.pill-btn` `::after`
  rules shipped with `Â¹` byte pairs where `✓` / `✕` belonged, so
  students saw a literal **¹1** and **¹7** appended to answer buttons. It
  survived from the v2→v3 revision until someone looked at a button. Nothing in
  `tools/` can catch this: the static checkers parse structure, and the browser
  checks assert behaviour — neither reads glyphs. If you edit CSS `content:`
  values or any literal symbol, **look at the rendered element**, and prefer
  writing patch scripts with a file-write tool (see §7) over anything that
  round-trips text through a shell.

- **Generated exam items are verified by re-derivation, not by review.** Every
  answer is checked twice against 14 CFR 107.51 by two independent
  implementations, and the prose is templated, but nobody has read all of the
  combinations — there are effectively unlimited ones. The distractors are the
  part most worth spot-checking if a student reports a bad question.
- **Touch-drag on the ordering exercise is untested on a real device.** The
  click-to-move fallback is fully tested and is the supported path.
- **Campus elevation (~1,380 ft) is not independently sourced** — retained at the
  teacher's instruction and labelled approximate.
- **Page is ~15 screens at rest, ~40 on mobile with everything expanded.** Fine
  for a nav-driven reference; worth watching if more sections are added.
- The section-order change (hero above the live report) is a single contiguous
  block move and is trivially reversible if the teacher prefers the live report
  first.
