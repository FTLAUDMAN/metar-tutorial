/* ===========================================================================
   GENERATED EXAM ITEM FUZZ  (browser)
   ---------------------------------------------------------------------------
   regress_examgen.js re-derives every generated answer with a parser written
   inside that script. This does the complementary job: it runs the generated
   reports through the page's OWN parseMETAR() and screening functions, which
   the node tool cannot reach.

   That matters for two reasons a static check cannot cover:

     1. A generated report has to be a report the rest of the page can read.
        If a template ever emitted a group parseMETAR() does not recognise, the
        exam would still look fine while the same string pasted into the
        Decoder produced "Unknown / Unparsed". Part A fails on any leftover.

     2. The exam item and the page's own reportedMinimumsStatus() must agree
        about the same report. If they drift, a student gets one answer in
        Exam Mode and the opposite one in the Decoder.

   Part B then drives the exam UI as a student does, and checks that the draw
   really is unmemorisable: at least four of the ten questions in every run
   must be items that are not in the hand-written bank.

   HOW TO RUN
     1. python -m http.server 8730 --bind 127.0.0.1
     2. Open http://127.0.0.1:8730/metar-tutorial_3.html
     3. Paste this whole file into the devtools console.

   Expect mismatches: 0 and generatedPerRun entries of 4.
   =========================================================================== */
(() => {
  const N = 2000;
  const RUNS = 3;
  const fails = [];
  const shapes = {};
  const note = m => { if (fails.length < 10) fails.push(m); };
  const nf = n => n.toLocaleString();

  /* ---- Part A: generated items vs the page's own parser ----------------- */
  for (let i = 0; i < N; i++) {
    const it = EXAM_GEN.batch(1)[0];
    shapes[it.gen] = (shapes[it.gen] || 0) + 1;

    const parsed = parseMETAR(it.metar);
    const meta = parsed.meta;
    const correct = String(it.choices[it.answer]);

    const leftover = parsed.fields.filter(f => f.type === 'unknown');
    if (leftover.length)
      note(`[${it.gen}] parseMETAR could not read "${leftover.map(f => f.raw).join(' ')}" in: ${it.metar}`);

    // Sky cover is reported on a summation basis, so it cannot decrease with
    // height. Checked here as well as in regress_examgen.js because it is a
    // property of the report rather than of any one template.
    const RANK = {FEW: 1, SCT: 2, BKN: 3, OVC: 4, VV: 4};
    const codes = it.metar.match(/\b(FEW|SCT|BKN|OVC)\d{3}\b/g) || [];
    for (let k = 1; k < codes.length; k++)
      if (RANK[codes[k].slice(0, 3)] < RANK[codes[k - 1].slice(0, 3)])
        note(`[${it.gen}] sky cover decreases with height (${codes[k - 1]} then ${codes[k]}) -- ${it.metar}`);

    switch (it.gen) {
      case 'ceiling': {
        const want = meta.ceilingFt === null
          ? 'There is no ceiling in this report'
          : `${nf(meta.ceilingFt)} ft AGL`;
        if (correct !== want) note(`[ceiling] "${correct}" vs parseMETAR "${want}" -- ${it.metar}`);
        break;
      }
      case 'lowest-layer': {
        if (meta.lowestLayerFt === null) { note(`[lowest-layer] no layer parsed -- ${it.metar}`); break; }
        if (!correct.endsWith(`— ${nf(meta.lowestLayerFt)} ft`))
          note(`[lowest-layer] "${correct}" vs parseMETAR lowest ${meta.lowestLayerFt} -- ${it.metar}`);
        break;
      }
      case 'under-cloud': {
        // 107.51(d)(1) measured from the lowest layer of ANY coverage, then
        // capped by 107.51(b). Exactly what part107Box shows for the same
        // report, so the two surfaces cannot disagree.
        let want;
        if (meta.lowestLayerFt === null) want = '400 ft AGL';
        else {
          const under = Math.max(0, meta.lowestLayerFt - 500);
          want = under === 0
            ? 'No altitude works — that layer leaves nothing underneath'
            : `${nf(Math.min(400, under))} ft AGL`;
        }
        if (correct !== want) note(`[under-cloud] "${correct}" vs parseMETAR "${want}" -- ${it.metar}`);
        break;
      }
      case 'visibility-screen': {
        const meets = correct.startsWith('MET');
        const status = reportedMinimumsStatus(meta);
        const visFails = status.fails.some(f => /visibility/.test(f));
        // The item screens visibility only; the page's screen also weighs the
        // cloud layer. They must agree on the visibility half of it.
        if (meets && visFails)
          note(`[visibility-screen] item says MET, reportedMinimumsStatus flags visibility -- ${it.metar}`);
        if (!meets && !visFails)
          note(`[visibility-screen] item says NOT MET, reportedMinimumsStatus does not flag visibility -- ${it.metar}`);
        break;
      }
      case 'spread-value': {
        if (correct !== `${meta.spread} °C`)
          note(`[spread-value] "${correct}" vs parseMETAR spread ${meta.spread} -- ${it.metar}`);
        break;
      }
      case 'wind-decode': {
        if (meta.windSpeedKt === null) { note(`[wind-decode] no wind parsed -- ${it.metar}`); break; }
        if (meta.windSpeedKt !== 0 && !correct.includes(`${meta.windSpeedKt} kt`))
          note(`[wind-decode] "${correct}" omits parsed speed ${meta.windSpeedKt} -- ${it.metar}`);
        if (meta.windGustKt !== null && !correct.includes(`${meta.windGustKt} kt`))
          note(`[wind-decode] "${correct}" omits parsed gust ${meta.windGustKt} -- ${it.metar}`);
        break;
      }
      default: break;   // time and prose items carry nothing parseMETAR can confirm
    }
  }

  /* ---- Part B: drive the exam the way a student does -------------------- */
  const bankQuestions = new Set(EXAM_BANK.map(q => q.q));
  const generatedPerRun = [];
  const uiProblems = [];
  const seenGenerated = new Set();

  for (let run = 0; run < RUNS; run++) {
    document.getElementById('examStartPractice').click();
    let generated = 0;

    for (let n = 0; n < 10; n++) {
      const qEl = document.querySelector('#examBody .exam-q');
      const choices = [...document.querySelectorAll('#examBody .exam-choice')];
      if (!qEl) { uiProblems.push(`run ${run} q${n}: no question rendered`); break; }
      if (choices.length < 3) uiProblems.push(`run ${run} q${n}: only ${choices.length} choices`);

      const text = qEl.innerHTML;
      if (!bankQuestions.has(text)) { generated++; seenGenerated.add(text + '||' + (document.querySelector('#examBody .metar-display') || {}).textContent); }

      // A generated item must still show a report to read it off.
      const metarEl = document.querySelector('#examBody .metar-display');
      if (!bankQuestions.has(text) && !metarEl)
        uiProblems.push(`run ${run} q${n}: generated item rendered without a METAR`);

      choices[0].click();
      const expl = document.getElementById('examExplain');
      if (!expl.classList.contains('show'))
        uiProblems.push(`run ${run} q${n}: practice mode gave no explanation`);
      if (/undefined|NaN|\$\{/.test(expl.textContent))
        uiProblems.push(`run ${run} q${n}: explanation contains "${expl.textContent.slice(0, 60)}"`);
      if (choices.some(c => !c.disabled))
        uiProblems.push(`run ${run} q${n}: choices still clickable after answering`);

      document.getElementById('examNextBtn').click();
    }

    const res = document.getElementById('examResults');
    if (getComputedStyle(res).display === 'none') uiProblems.push(`run ${run}: results panel never appeared`);
    if (!/of 10/.test(res.textContent)) uiProblems.push(`run ${run}: results do not report 10 questions`);
    generatedPerRun.push(generated);
  }

  return {
    itemsChecked: N,
    mismatches: fails.length,
    firstFailures: fails,
    templateDistribution: shapes,
    examRuns: RUNS,
    generatedPerRun,                      // MUST be [4, 4, 4]
    distinctGeneratedAcrossRuns: seenGenerated.size,   // MUST equal 4 * RUNS
    uiProblems                            // MUST be []
  };
})()
