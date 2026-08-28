// Renders the page with a real browser engine and checks the two things that
// only a rendered page can settle:
//
//   1. PRINT. The page ships a print stylesheet that must emit the cheat sheet
//      and nothing else. browser-regression.js infers that by reading the
//      @media print rules and asking which top-level elements no rule hides --
//      good, but it is CSS analysis, not output. This prints to PDF and reads
//      what actually lands on the paper.
//
//   2. LAYOUT of the generated exam items. Generated questions carry longer
//      stems and longer explanations than the hand-written ones, and they are
//      the only items nobody has looked at, because there are unlimited of
//      them. This drives the exam to a generated question and captures it at
//      desktop and phone widths so the wrapping can be seen.
//
// Drives headless Edge/Chrome over the DevTools Protocol using Node's built-in
// WebSocket and fetch. No packages to install, but unlike the rest of tools/
// it needs a browser binary and a running server, which is why check.py does
// not run it.
//
//   1. python -m http.server 8730 --bind 127.0.0.1
//   2. node tools/render-check.js [url] [outDir]
//
// Browser is found automatically; override with the BROWSER env var.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const URL_ = process.argv[2] || 'http://127.0.0.1:8730/metar-tutorial_3.html';
const OUT = process.argv[3] || path.join(__dirname, 'render-out');
const PORT = 9222;

const CANDIDATES = [
  process.env.BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/microsoft-edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const BIN = CANDIDATES.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
if (!BIN) {
  console.error('No Chromium-based browser found. Set BROWSER=/path/to/chrome and retry.');
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'render-check-'));

const child = spawn(BIN, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
  '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const problems = [];
const results = {};

// ---- minimal DevTools Protocol client ------------------------------------
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map();
    ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      } else if (m.method && this.handlers.has(m.method)) {
        this.handlers.get(m.method).forEach(f => f(m.params));
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }
  once(method) { return new Promise(r => this.on(method, p => r(p))); }
  async evaluate(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'evaluate threw');
    return r.result.value;
  }
}

async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find(t => t.type === 'page');
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
        return new CDP(ws);
      }
    } catch (e) { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('could not attach to the browser');
}

async function load(cdp, width, height, mobile) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 2, mobile,
  });
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: URL_ });
  await loaded;
  await sleep(900);           // let the offline fallback settle
}

// Walks Exam Mode to a question that is not in the hand-written bank, and
// returns the exam card's box in PAGE coordinates. The box is what gets
// captured: an earlier version scrolled the section into view and shot the
// viewport, which raced the page's smooth scrolling and caught the wrong
// section mid-animation. Clipping needs no scroll at all.
const DRIVE_TO_GENERATED = `(() => {
  const bank = new Set(EXAM_BANK.map(q => q.q));
  document.getElementById('examStartPractice').click();
  for (let n = 0; n < 10; n++) {
    const q = document.querySelector('#examBody .exam-q');
    if (q && !bank.has(q.innerHTML)) {
      const metar = document.querySelector('#examBody .metar-display');
      const shell = document.getElementById('examShell');
      const r = shell.getBoundingClientRect();
      const pad = 16;
      return {position: n + 1,
              question: q.textContent,
              metar: metar ? metar.textContent : null,
              choices: [...document.querySelectorAll('#examBody .exam-choice')].map(b => b.textContent.trim()),
              box: {x: Math.max(0, r.left + scrollX - pad), y: Math.max(0, r.top + scrollY - pad),
                    width: r.width + pad * 2, height: r.height + pad * 2}};
    }
    document.querySelectorAll('#examBody .exam-choice')[0].click();
    document.getElementById('examNextBtn').click();
  }
  return null;
})()`;

// Measured immediately before each capture, never earlier: the live-report
// section swaps in its offline fallback after load, which reflows everything
// below it. A box measured before that settles points at the wrong place.
const MEASURE = `(() => {
  const shell = document.getElementById('examShell');
  const r = shell.getBoundingClientRect();
  const pad = 16;
  return {x: Math.max(0, r.left + scrollX - pad), y: Math.max(0, r.top + scrollY - pad),
          width: r.width + pad * 2, height: r.height + pad * 2};
})()`;

// Any element wider than its container is a layout bug at that width.
const OVERFLOW_SCAN = `(() => {
  const de = document.documentElement;
  const bad = [...document.querySelectorAll('#exam *')]
    .filter(el => el.getBoundingClientRect().width > de.clientWidth + 1)
    .map(el => (el.tagName + '.' + (el.className || '')).slice(0, 60));
  return {pageOverflow: document.body.scrollWidth > de.clientWidth + 2,
          wideElements: [...new Set(bad)].slice(0, 5),
          clientWidth: de.clientWidth};
})()`;

(async () => {
  let cdp;
  try {
    cdp = await connect();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    // ---- 1. desktop: a generated exam item ----
    await load(cdp, 1280, 900, false);
    const shown = await cdp.evaluate(DRIVE_TO_GENERATED);
    if (!shown) problems.push('desktop: no generated item appeared in ten questions');
    results.generatedItem = shown;
    await sleep(700);
    results.desktopBox = await cdp.evaluate(MEASURE);
    let shot = await cdp.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true,
      clip: { ...results.desktopBox, scale: 1 },
    });
    fs.writeFileSync(path.join(OUT, 'exam-generated-desktop.png'), Buffer.from(shot.data, 'base64'));
    results.desktopOverflow = await cdp.evaluate(OVERFLOW_SCAN);
    if (results.desktopOverflow.pageOverflow) problems.push('desktop: page overflows horizontally');
    if (results.desktopOverflow.wideElements.length) problems.push('desktop: elements wider than the viewport: ' + results.desktopOverflow.wideElements.join(', '));

    // ---- 2. phone: the same, reloaded so load-time gates re-run ----
    await load(cdp, 390, 844, true);
    const shownM = await cdp.evaluate(DRIVE_TO_GENERATED);
    if (!shownM) problems.push('mobile: no generated item appeared in ten questions');
    results.generatedItemMobile = shownM && {question: shownM.question, metar: shownM.metar};
    await sleep(700);
    results.mobileBox = await cdp.evaluate(MEASURE);
    shot = await cdp.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true,
      clip: { ...results.mobileBox, scale: 1 },
    });
    fs.writeFileSync(path.join(OUT, 'exam-generated-mobile.png'), Buffer.from(shot.data, 'base64'));
    results.mobileOverflow = await cdp.evaluate(OVERFLOW_SCAN);
    if (results.mobileOverflow.pageOverflow) problems.push('mobile: page overflows horizontally');
    if (results.mobileOverflow.wideElements.length) problems.push('mobile: elements wider than the viewport: ' + results.mobileOverflow.wideElements.join(', '));

    // ---- 3. the dashboard's next-action panel ----
    // Seeded with a weak category, because the panel is correctly invisible to
    // a student who has no history yet.
    await load(cdp, 1280, 900, false);
    await cdp.evaluate(`(() => {
      localStorage.setItem('bwhs_metar_examCatWeights', JSON.stringify({'Clouds':0.35,'Wind':0.95}));
      localStorage.setItem('bwhs_metar_activeDays', JSON.stringify(['2026-01-01','2026-01-02']));
      PROGRESS.updateDashboard();
      return true;
    })()`);
    await sleep(400);
    results.nextActionBox = await cdp.evaluate(`(() => {
      const el = document.getElementById('dashNext');
      const r = el.getBoundingClientRect();
      return {visible: getComputedStyle(el).display !== 'none',
              x: Math.max(0, r.left + scrollX - 12), y: Math.max(0, r.top + scrollY - 12),
              width: r.width + 24, height: r.height + 24};
    })()`);
    if (!results.nextActionBox.visible) problems.push('next-action panel did not appear for a weak category');
    shot = await cdp.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true,
      clip: { x: results.nextActionBox.x, y: results.nextActionBox.y,
              width: results.nextActionBox.width, height: results.nextActionBox.height, scale: 1 },
    });
    fs.writeFileSync(path.join(OUT, 'dashboard-next-action.png'), Buffer.from(shot.data, 'base64'));

    // ---- 4. the free-response rationale panel, rubric open ----
    await load(cdp, 1280, 900, false);
    results.rationale = await cdp.evaluate(`(() => {
      const card = document.querySelector('.gng-card');
      const sc = GONOGO_SCENARIOS.find(s => s.id === card.dataset.scenarioId);
      card.querySelector('[data-mins="' + sc.reportedMins + '"]').click();
      card.querySelector('[data-op="' + sc.operational + '"]').click();
      card.querySelector('[data-conf="unsure"]').click();
      card.querySelector('.factor-row .pill-btn').click();
      card.querySelector('.driver-row .pill-btn').click();
      card.querySelector('.mit-row .pill-btn').click();
      document.getElementById('ratText').value =
        'Reported minimums are MET \\u2014 10 SM and the only layer is at 12,000 ft.';
      document.getElementById('ratCheckBtn').click();
      return {scenario: sc.id, modelLength: document.getElementById('ratModel').textContent.length};
    })()`);
    await sleep(500);
    const ratBox = await cdp.evaluate(`(() => {
      const el = document.getElementById('rationale');
      const r = el.getBoundingClientRect();
      return {x: Math.max(0, r.left + scrollX - 12), y: Math.max(0, r.top + scrollY - 12),
              width: r.width + 24, height: r.height + 24};
    })()`);
    shot = await cdp.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true, clip: { ...ratBox, scale: 1 },
    });
    fs.writeFileSync(path.join(OUT, 'rationale-panel.png'), Buffer.from(shot.data, 'base64'));

    // ---- 5. print ----
    await load(cdp, 1280, 900, false);
    const pdf = await cdp.send('Page.printToPDF', {
      printBackground: true, preferCSSPageSize: true,
      paperWidth: 8.5, paperHeight: 11,
      marginTop: 0.4, marginBottom: 0.4, marginLeft: 0.4, marginRight: 0.4,
    });
    const bytes = Buffer.from(pdf.data, 'base64');
    fs.writeFileSync(path.join(OUT, 'print.pdf'), bytes);
    results.printPdfBytes = bytes.length;
    results.printPages = (bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

    // Now put the page into print media and ask the LAYOUT what survives,
    // rather than asking the stylesheet what it hides. This is the difference
    // between "no rule hides this element" and "this element occupies no space
    // on the printed page" -- a rule can be overridden, a box cannot lie.
    await cdp.send('Emulation.setEmulatedMedia', { media: 'print' });
    await sleep(400);
    results.printLayout = await cdp.evaluate(`(() => {
      const rows = [...document.body.children]
        .filter(el => el.tagName !== 'SCRIPT')
        .map(el => {
          const r = el.getBoundingClientRect();
          return {who: el.id || el.tagName, w: Math.round(r.width), h: Math.round(r.height)};
        });
      return {inked: rows.filter(r => r.w > 0 && r.h > 0).map(r => r.who),
              blank: rows.filter(r => r.w === 0 || r.h === 0).map(r => r.who)};
    })()`);
    const expectedInked = ['main-content'];
    if (JSON.stringify(results.printLayout.inked) !== JSON.stringify(expectedInked))
      problems.push('print layout: ' + JSON.stringify(results.printLayout.inked) + ' occupy space, expected only ' + JSON.stringify(expectedInked));

    const full = await cdp.evaluate(`(() => {
      const el = document.getElementById('cheatsheet');
      const r = el.getBoundingClientRect();
      return {x: 0, y: Math.max(0, r.top + scrollY), width: document.documentElement.clientWidth, height: r.height};
    })()`);
    shot = await cdp.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true, clip: { ...full, scale: 1 },
    });
    fs.writeFileSync(path.join(OUT, 'print-preview.png'), Buffer.from(shot.data, 'base64'));
    await cdp.send('Emulation.setEmulatedMedia', { media: '' });

    // What the print stylesheet leaves standing, per the page itself.
    results.printSurvivors = await cdp.evaluate(`(() => {
      const hiders = [];
      for (const sheet of document.styleSheets) {
        let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
        for (const r of rules)
          if (r.type === CSSRule.MEDIA_RULE && r.conditionText.includes('print'))
            for (const sub of r.cssRules)
              if (sub.style.cssText.includes('display: none')) hiders.push(sub.selectorText);
      }
      return [...document.body.children]
        .filter(el => el.tagName !== 'SCRIPT' &&
          !hiders.some(h => { try { return el.matches(h); } catch (e) { return false; } }))
        .map(el => el.id || el.tagName);
    })()`);
    const expectedSurvivors = ['main-content'];
    if (JSON.stringify(results.printSurvivors) !== JSON.stringify(expectedSurvivors))
      problems.push('print: survivors are ' + JSON.stringify(results.printSurvivors) + ', expected ' + JSON.stringify(expectedSurvivors));

    results.outputDir = OUT;
    results.browser = BIN;
    console.log(JSON.stringify(results, null, 2));
    if (problems.length) {
      console.log('\n--- FAILED ---');
      problems.forEach(p => console.log('  ' + p));
      process.exitCode = 1;
    } else {
      console.log('\nRendered checks passed. Artifacts in ' + OUT);
    }
  } catch (e) {
    console.error('render-check failed:', e.message);
    process.exitCode = 1;
  } finally {
    try { child.kill(); } catch (e) {}
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
    process.exit(process.exitCode || 0);
  }
})();
