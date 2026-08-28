/* ===========================================================================
   FULL RUNTIME REGRESSION SWEEP
   ---------------------------------------------------------------------------
   The static checkers (validate.js, regress.js, refcheck.js) verify data and
   references. This exercises the page as a student actually would: every module
   rendering, every interaction firing, accessibility intact, print isolated.

   HOW TO RUN
     1. python -m http.server 8730 --bind 127.0.0.1
     2. Open http://127.0.0.1:8730/metar-tutorial_3.html
     3. Paste this whole file into the devtools console.

   NOTE ON CONSOLE ERRORS: two aviationweather.gov CORS errors per page load are
   EXPECTED -- that host sends no Access-Control-Allow-Origin header, so the
   offline fallback engaging is correct behaviour. Any OTHER console error is a
   real bug. This script reports `runtimeErrors` from window.onerror only.
   =========================================================================== */
(() => {
  const errs = [];
  window.addEventListener('error', e => errs.push(e.message));
  /* Sampled before anything below drives the page: section 8 works a Go/No-Go
     scenario to completion, which legitimately reveals the rationale panel.
     Asking later would measure this script's own side effect. */
  const ratInitialDisplay = getComputedStyle(document.getElementById('rationale')).display;
  localStorage.clear();
  const out = {};
  const vis = id => { const e = document.getElementById(id); return e ? getComputedStyle(e).display : 'missing'; };

  /* ---- 1. every module rendered ---------------------------------------- */
  out.modules = {
    hero:           document.querySelectorAll('#heroMetar .metar-token').length,   // expect 11
    anatomy:        document.querySelectorAll('#anatomyMetar .metar-token').length,// expect 11
    ordering:       document.querySelectorAll('#orderTray .order-chip').length,    // expect 10
    zulu:           document.getElementById('zQuestion').textContent !== 'Loading…',
    cloudDrill:     document.getElementById('ccQuestion').textContent.trim().length > 0,
    walkCards:      document.querySelectorAll('.walk-card').length,                // expect 5
    coldReadTokens: document.querySelectorAll('.walk-card')[4].querySelectorAll('.metar-token').length, // MUST be 0
    whatChanged:    !!document.getElementById('wcVerdictRow'),
    decoder:        !!document.querySelector('#decodeOutput .field-list'),
    builder:        !!document.querySelector('#builtMetar .metar-token'),
    tafBridge:      !!document.querySelector('#tafMetarDisplay .metar-token'),
    gngCards:       document.querySelectorAll('.gng-card').length,                 // expect 8
    todaySurface:   !!document.querySelector('#todaySurfaceOutput .metar-display'),
    cheatSopRows:   document.querySelectorAll('#cheatSopTable tr').length          // expect 4
  };
  out.sectionNumbers = [...document.querySelectorAll('.section-head .num')]
    .map(n => n.textContent).join(',');   // expect 01..12 in order

  /* ---- 2. parser fixes still hold -------------------------------------- */
  const probe = m => parseMETAR(m).fields.some(f => f.type === 'unknown') ? 'UNPARSED' : 'ok';
  out.parser = {
    variableRVR: probe('METAR KXNA 241853Z VRB03KT 1/4SM R18/0600V1000FT FG VV002 12/12 A2992 RMK AO2'),
    icaoMetric:  probe('METAR EGLL 241850Z 25012KT 9999 SCT030 14/09 Q1013 NOSIG'),
    usStandard:  probe('METAR KGGG 161753Z AUTO 14021G26KT 3/4SM +TSRA BR BKN008 OVC012CB 18/17 A2970 RMK AO2 PRESFR')
  };

  /* ---- 3. dashboard empty state (fresh visitor) ------------------------ */
  out.emptyState = { panel: vis('dashEmpty'), tiles: vis('dashGrid'), clearBtn: vis('dashActions') };
  // expect panel:block, tiles:none, clearBtn:none on a cleared store

  /* ---- 4. Go/No-Go: six steps in order, reveal only at the end --------- */
  const card = document.querySelectorAll('.gng-card')[3];
  const stepVis = () => ['verify','operational','conf','factor','driver','mit']
    .map(k => (getComputedStyle(card.querySelector('.step-' + k)).display !== 'none') ? 1 : 0).join('');
  const seq = [stepVis()];
  ['[data-mins="notmet"]','.op-row .pill-btn','.conf-row .pill-btn',
   '.factor-row .pill-btn','.driver-row .pill-btn','.mit-row .pill-btn']
    .forEach(sel => { card.querySelector(sel).click(); seq.push(stepVis()); });
  out.gng = {
    stepSequence: seq,                    // expect 000000,110000,111000,...,111111
    revealedOnlyAtEnd: card.querySelector('.gng-answer').classList.contains('show'),
    compactPromptsPerCard: document.querySelectorAll('#gonogo .verify-prompt').length,
    fullChecklistsInSection: document.querySelectorAll('#gonogo .verify-box').length // MUST be 1
  };

  /* ---- 5. ordering click-to-move, tabs, walkthrough autoplay ----------- */
  const tray = document.getElementById('orderTray'), slot = document.getElementById('orderSlot');
  [...tray.querySelectorAll('.order-chip')]
    .sort((a, b) => +a.dataset.correct - +b.dataset.correct).forEach(c => c.click());
  document.getElementById('orderCheckBtn').click();
  out.ordering = { placedCorrect: slot.querySelectorAll('.correct-pos').length,
                   feedback: document.getElementById('orderFeedback').className };

  const tabs = [...document.querySelectorAll('.tabbar button')];
  tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  out.tabKeyboard = tabs.map(b => b.getAttribute('aria-selected')).join(',');  // expect false,true,false
  tabs[0].click();

  const c1 = document.querySelectorAll('.walk-card')[0], autoBtn = c1.querySelector('.walk-auto');
  autoBtn.click();
  document.querySelectorAll('#walkDots .dot')[2].click();   // jump away mid-playback
  out.autoplayStopsOnNav = autoBtn.textContent === '▶ Walk Me Through It';

  /* ---- 6. accessibility ------------------------------------------------ */
  out.a11y = {
    liveRegions: document.querySelectorAll('[aria-live]').length,   // ~30
    unlabelledControls: [...document.querySelectorAll('input,select,textarea')].filter(el => {
      const lbl = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      return !lbl && !el.closest('label') && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby');
    }).length                                                        // MUST be 0
  };

  /* ---- 7. print isolates the cheat sheet ------------------------------- */
  const hiders = [];
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
    for (const r of rules)
      if (r.type === CSSRule.MEDIA_RULE && r.conditionText.includes('print'))
        for (const sub of r.cssRules)
          if (sub.style.cssText.includes('display: none')) hiders.push(sub.selectorText);
  }
  out.printSurvivors = [...document.body.children]
    .filter(el => el.tagName !== 'SCRIPT' &&
      !hiders.some(h => { try { return el.matches(h); } catch (e) { return false; } }))
    .map(el => el.id || el.tagName);                                 // MUST be ['main-content']

  /* ---- 8. spaced practice and the next-action panel --------------------- */
  /* The recommendation is the dashboard's only instruction, so the thing that
     matters is that it stays silent when it has nothing to say. A panel that
     always demands something teaches students to ignore it. */
  {
    const K = 'bwhs_metar_';
    const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
    const why = () => document.getElementById('dashNextWhy').textContent;

    localStorage.clear(); PROGRESS.updateDashboard();
    const freshPanel = getComputedStyle(document.getElementById('dashNext')).display;

    localStorage.setItem(K + 'examCatWeights', JSON.stringify({ 'Clouds': 0.35, 'Wind': 0.95 }));
    PROGRESS.updateDashboard();
    const weak = { kind: PROGRESS.recommend().kind, href: document.getElementById('dashNextBtn').getAttribute('href'), why: why() };

    localStorage.clear();
    localStorage.setItem(K + 'examCatWeights', JSON.stringify({ 'Time': 0.95 }));
    localStorage.setItem(K + 'catSchedule', JSON.stringify({ 'Time': { last: daysAgo(9), interval: 2 } }));
    PROGRESS.updateDashboard();
    const due = { kind: PROGRESS.recommend().kind, href: document.getElementById('dashNextBtn').getAttribute('href') };

    // Corrupt data must degrade to a nudge, never throw.
    localStorage.clear();
    localStorage.setItem(K + 'catSchedule', '{"Clouds":{"last":42,"interval":"banana"},"Wind":null}');
    let scheduleThrew = null;
    try { PROGRESS.updateDashboard(); } catch (e) { scheduleThrew = e.message; }

    // Leitner: right doubles the gap, wrong resets it to one day.
    localStorage.clear();
    PROGRESS.recordPractice('Wind', 1); PROGRESS.recordPractice('Wind', 1);
    const grown = PROGRESS.loadSchedule()['Wind'].interval;      // MUST be 4
    PROGRESS.recordPractice('Wind', 0);
    const reset = PROGRESS.loadSchedule()['Wind'].interval;      // MUST be 1

    out.nextAction = {
      hiddenForFreshVisitor: freshPanel === 'none',   // MUST be true
      weakKind: weak.kind, weakHref: weak.href,       // MUST be 'weak', '#cloudclear'
      dueKind: due.kind, dueHref: due.href,           // MUST be 'due', '#zulu'
      scheduleThrew,                                  // MUST be null
      intervalAfterTwoPasses: grown,                  // MUST be 4
      intervalAfterAMiss: reset,                      // MUST be 1
    };
    localStorage.clear();
  }

  /* ---- 9. free-response rationale --------------------------------------- */
  {
    const panel = document.getElementById('rationale');
    const card = document.querySelector('.gng-card');
    const sc = GONOGO_SCENARIOS.find(s => s.id === card.dataset.scenarioId);
    card.querySelector(`[data-mins="${sc.reportedMins}"]`).click();
    card.querySelector(`[data-op="${sc.operational}"]`).click();
    card.querySelector('[data-conf="unsure"]').click();
    card.querySelector('.factor-row .pill-btn').click();
    card.querySelector('.driver-row .pill-btn').click();
    card.querySelector('.mit-row .pill-btn').click();

    document.getElementById('ratText').value = 'Minimums MET at 10 SM.';
    document.getElementById('ratCheckBtn').click();
    const model = document.getElementById('ratModel').textContent;

    out.rationale = {
      hiddenOnPageLoad: ratInitialDisplay === 'none',                // MUST be true
      shownAfterScenario: getComputedStyle(panel).display !== 'none',// MUST be true
      rubricItems: document.querySelectorAll('#ratRubric .rat-item').length,   // MUST be 4
      // The model answer is composed from scenario data; empty means a lookup
      // broke, which is exactly how the first version failed.
      modelLength: model.length,                                     // MUST be > 80
      modelClean: !/undefined|NaN|\[object/.test(model),             // MUST be true
      // Every generated control must carry a label of its own.
      rubricLabelled: [...document.querySelectorAll('#ratRubric input')]
        .every(i => document.querySelector(`label[for="${i.id}"]`)), // MUST be true
    };
    localStorage.clear();
  }

  /* ---- 10. layout ------------------------------------------------------- */
  const de = document.documentElement;
  out.horizontalOverflow = document.body.scrollWidth > de.clientWidth + 2;  // MUST be false
  out.landsAtTop = window.scrollY === 0;   // no module may steal focus on load
  out.runtimeErrors = errs;                // MUST be []
  return out;
})()
