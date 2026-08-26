/* ===========================================================================
   CLOUD CLEARANCE DRILL — CROSS-VALIDATION HARNESS
   ---------------------------------------------------------------------------
   The strongest correctness check in this project, and the reason the drill can
   be trusted: it never takes the drill's word for anything.

   For each generated question it rebuilds a synthetic METAR from the sky groups
   shown on screen, runs that through the page's OWN parseMETAR() to find the
   lowest cloud layer independently, computes the answer straight from
   14 CFR 107.51, submits it, and requires the drill to accept it.

   Two independent implementations agreeing on thousands of random cases is a
   much stronger statement than either one passing its own unit tests.

   HOW TO RUN
     1. Serve the page over HTTP (localStorage is dead in file:// and data:):
          python -m http.server 8730 --bind 127.0.0.1
     2. Open http://127.0.0.1:8730/metar-tutorial_3.html
     3. Paste this whole file into the devtools console.
        (Or hand it to a browser-automation javascript tool.)

   EXPECT: mismatches: 0. Anything else is a regression in either the drill or
   the parser -- read `firstFailures` to see which.
   =========================================================================== */
(() => {
  const N = 2000;                      // lower to ~300 for a quick smoke test
  localStorage.clear();

  const qEl   = document.getElementById('ccQuestion');
  const inEl  = document.getElementById('ccInput');
  const fbEl  = document.getElementById('ccFeedback');
  const skip  = document.getElementById('ccSkipBtn');
  const check = document.getElementById('ccCheckBtn');
  if (!qEl) return 'Cloud drill not found -- is this the right page?';

  const fails = [], shapes = {};

  for (let n = 0; n < N; n++) {
    skip.click();
    const text = qEl.textContent.trim();
    let expected, tag;

    if (/from the nearest cloud/.test(text)) {
      /* 107.51(d)(2): 2,000 ft horizontally, independent of altitude. */
      const dist = parseInt(text.replace(/[^0-9]/g, ''), 10);
      expected = Math.max(0, 2000 - dist);
      tag = 'horizontal';
      if (!(dist >= 0 && dist <= 3400)) fails.push(`h: implausible distance ${dist}`);
    } else {
      /* Independent read of the sky via the page's own parser. */
      const synthetic = 'METAR KXNA 241853Z 09006KT 10SM ' + text + ' 20/10 A3000 RMK AO2';
      const parsed = parseMETAR(synthetic);
      if (parsed.fields.some(f => f.type === 'unknown'))
        fails.push(`v: parser could not read "${text}"`);

      const lowest = parsed.meta.lowestLayerFt;
      /* 107.51(d)(1) 500 ft below ANY cloud, capped by 107.51(b) 400 ft AGL.
         Structure exception excluded -- the drill prompt says so. */
      expected = lowest === null ? 400 : Math.min(400, Math.max(0, lowest - 500));
      tag = lowest === null ? 'clear'
          : expected === 0 ? 'nofly'
          : expected < 400 ? 'binding'
          : 'capped';

      /* Structural invariants of a plausible METAR sky group. */
      const groups = text.split(/\s+/);
      const hts = groups.map(g => {
        const m = g.match(/^(FEW|SCT|BKN|OVC|VV)(\d{3})$/);
        return m ? +m[2] : null;
      }).filter(x => x !== null);
      for (let k = 1; k < hts.length; k++)
        if (hts[k] <= hts[k - 1]) fails.push(`v: layers not ascending: ${text}`);
      const ovcAt = groups.findIndex(g => /^OVC/.test(g));
      if (ovcAt !== -1 && ovcAt !== groups.length - 1)
        fails.push(`v: a layer sits above an overcast: ${text}`);
      /* Sky cover is reported on a SUMMATION basis -- the amount shown for a
         layer is the total sky covered at and below it -- so it can never
         decrease with height. BKN008 FEW045 is not a real report, and a drill
         that shows one teaches a convention that does not exist. */
      const RANK = {FEW: 1, SCT: 2, BKN: 3, OVC: 4, VV: 4};
      const covs = groups.map(g => (g.match(/^(FEW|SCT|BKN|OVC|VV)\d{3}$/) || [])[1]).filter(Boolean);
      for (let k = 1; k < covs.length; k++)
        if (RANK[covs[k]] < RANK[covs[k - 1]])
          fails.push(`v: sky cover decreases with height (summation violated): ${text}`);
      if (expected < 0 || expected > 400)
        fails.push(`v: answer out of range ${expected}: ${text}`);
    }

    shapes[tag] = (shapes[tag] || 0) + 1;

    inEl.value = String(expected);
    check.click();
    if (!/^Correct/.test(fbEl.textContent.trim()))
      fails.push(`MISMATCH "${text}" -- independent answer ${expected}; drill said: ${fbEl.textContent.slice(0, 90)}`);
  }

  return {
    questionsTested: N,
    mismatches: fails.length,
    firstFailures: fails.slice(0, 8),
    shapeDistribution: shapes,   // expect a spread; most should need arithmetic
    cumulative: JSON.parse(localStorage.getItem('bwhs_metar_cloudCumV1') || 'null')
  };
})()
