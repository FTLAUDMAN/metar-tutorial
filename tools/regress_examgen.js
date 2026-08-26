// Fuzzes the generated half of the exam bank.
//
// EXAM_GEN builds exam items from random METARs at runtime, so there is no
// authored answer key to diff against -- the answers have to be re-derived.
// This script pulls the EXAM_GEN literal out of the page, generates a few
// thousand items, and for each one:
//
//   * re-parses the generated report with an INDEPENDENT parser written here,
//     sharing no code with the generator or with the page, and
//   * recomputes the answer straight from 14 CFR 107.51 and the US METAR
//     conventions, and requires the item's marked answer to match.
//
// Same idea as browser-cloud-fuzz.js: two implementations that must agree
// across thousands of random cases. It also enforces the editorial doctrine
// that cannot be checked by arithmetic -- no legality verdicts, the 2,000 ft
// horizontal obligation restated alongside every altitude answer, and the
// site-verification caveat on every visibility item.
//
//   node regress_examgen.js [count]        (default 4000)

const fs = require('fs');
const path = process.env.METAR_HTML ||
  require('path').join(__dirname, '..', 'metar-tutorial_3.html');
const html = fs.readFileSync(path, 'utf8');
const js = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));

// Same bracket-matching extractor validate.js uses, so a template literal or a
// comment inside the object cannot end the slice early.
function extractDecl(name) {
  const marker = 'const ' + name + ' = ';
  const start = js.indexOf(marker);
  if (start < 0) throw new Error('not found: ' + name);
  let i = start + marker.length;
  const open = js[i];
  const close = open === '[' ? ']' : '}';
  let depth = 0, inStr = null, esc = false, inTpl = false;
  for (; i < js.length; i++) {
    const c = js[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (inStr) { if (c === inStr) inStr = null; continue; }
    if (inTpl) { if (c === '`') inTpl = false; continue; }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '`') { inTpl = true; continue; }
    if (c === '/' && js[i + 1] === '*') { i = js.indexOf('*/', i) + 1; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) { i++; break; } }
  }
  return js.slice(start + marker.length, i);
}

const EXAM_GEN = eval('(' + extractDecl('EXAM_GEN') + ')');

// EXAM_GEN must not reach outside itself, or this harness would be testing a
// different thing from what the page runs.
const external = extractDecl('EXAM_GEN').match(/\b(CLASS_SOP|PROGRESS|document|window|escapeHtml|parseMETAR)\b/);

const N = +(process.argv[2] || 4000);
const CATS = new Set(['Clouds', 'Visibility', 'Wind', 'Time', 'Temp / Dew']);
const errors = [];
const seen = new Set();
const perTemplate = {};

function fail(msg, item) {
  if (errors.length < 20) {
    errors.push(msg +
      '\n        metar: ' + item.metar +
      '\n        q: ' + item.q.replace(/<[^>]+>/g, '') +
      '\n        choices: ' + JSON.stringify(item.choices) + '  answer=' + item.answer);
  }
}

// ---- independent parser --------------------------------------------------
// Deliberately not the page's parseMETAR: if both sides shared a parser, a bug
// in it would cancel out and this check would pass on wrong answers.
function parse(metar) {
  const toks = metar.split(' ');
  const out = { sky: [], vis: null, visOp: '', wind: null, temp: null, dew: null, stamp: null };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (/^\d{6}Z$/.test(t)) { out.stamp = { day: +t.slice(0, 2), h: +t.slice(2, 4), m: +t.slice(4, 6) }; continue; }
    if (/^(\d{3}|VRB)\d{2}(G\d{2})?KT$/.test(t)) {
      const m = t.match(/^(\d{3}|VRB)(\d{2})(?:G(\d{2}))?KT$/);
      out.wind = { dir: m[1], speed: +m[2], gust: m[3] ? +m[3] : null };
      if (toks[i + 1] && /^\d{3}V\d{3}$/.test(toks[i + 1])) {
        out.wind.vlo = +toks[i + 1].slice(0, 3);
        out.wind.vhi = +toks[i + 1].slice(4, 7);
        i++;
      }
      continue;
    }
    if (/^\d$/.test(t) && toks[i + 1] && /^\d\/\dSM$/.test(toks[i + 1])) {           // "1 1/2SM"
      const f = toks[i + 1].match(/^(\d)\/(\d)SM$/);
      out.vis = +t + (+f[1] / +f[2]); i++; continue;
    }
    if (/^(M|P)?(\d{1,2})(?:\/(\d))?SM$/.test(t)) {
      const m = t.match(/^(M|P)?(\d{1,2})(?:\/(\d))?SM$/);
      out.vis = m[3] ? +m[2] / +m[3] : +m[2];
      out.visOp = m[1] === 'M' ? 'less than' : m[1] === 'P' ? 'more than' : '';
      continue;
    }
    if (/^(SKC|CLR|NSC)$/.test(t)) { out.sky.push({ cov: t, ft: null, code: t }); continue; }
    if (/^(FEW|SCT|BKN|OVC|VV)(\d{3})$/.test(t)) {
      const m = t.match(/^(FEW|SCT|BKN|OVC|VV)(\d{3})$/);
      out.sky.push({ cov: m[1], ft: +m[2] * 100, code: t }); continue;
    }
    if (/^(M?\d{2})\/(M?\d{2})$/.test(t)) {
      const m = t.match(/^(M?\d{2})\/(M?\d{2})$/);
      const dec = s => (s[0] === 'M' ? -1 : 1) * +s.replace('M', '');
      out.temp = dec(m[1]); out.dew = dec(m[2]); continue;
    }
  }
  const layers = out.sky.filter(s => s.ft !== null);
  out.lowest = layers.length ? layers.reduce((a, b) => (b.ft < a.ft ? b : a)) : null;
  // A ceiling is the lowest BKN, OVC or VV. FEW and SCT are not ceilings.
  const ceils = layers.filter(s => ['BKN', 'OVC', 'VV'].includes(s.cov));
  out.ceiling = ceils.length ? ceils.reduce((a, b) => (b.ft < a.ft ? b : a)) : null;
  return out;
}

const nf = n => n.toLocaleString();

for (let i = 0; i < N; i++) {
  const item = EXAM_GEN.batch(1)[0];
  perTemplate[item.gen] = (perTemplate[item.gen] || 0) + 1;

  // ---- shape: the same contract validate.js enforces on EXAM_BANK ----
  if (!CATS.has(item.cat)) fail(`[${item.gen}] cat "${item.cat}" is not one of the written bank's categories`, item);
  if (!item.q) fail(`[${item.gen}] missing question text`, item);
  if (!item.explain) fail(`[${item.gen}] missing explain`, item);
  // Exactly four, not "at least three". The looser version of this check let a
  // real defect through: template distractors can collide with the correct
  // answer once random values are substituted (temperature 13 over dew point 0
  // gives a temperature AND a spread of 13), and with no cap on the wrongs list
  // other templates ran long. 5.1% of items had five choices and 0.14% had
  // three -- a different guess baseline, and visibly odd next to the
  // hand-written bank, which is four throughout.
  if (!Array.isArray(item.choices) || item.choices.length !== 4)
    fail(`[${item.gen}] ${Array.isArray(item.choices) ? item.choices.length : 'non-array'} choices, expected exactly 4`, item);
  if (!Number.isInteger(item.answer) || item.answer < 0 || item.answer >= item.choices.length)
    fail(`[${item.gen}] answer index ${item.answer} out of range`, item);
  if (new Set(item.choices.map(c => String(c).trim())).size !== item.choices.length)
    fail(`[${item.gen}] duplicate choices -- more than one option may be correct`, item);
  if ((item.q + item.explain + item.choices.join('')).includes('${'))
    fail(`[${item.gen}] uninterpolated \${...} placeholder`, item);
  if (/\b(undefined|NaN)\b/.test(item.metar + item.q + item.explain + item.choices.join(' ')))
    fail(`[${item.gen}] undefined/NaN leaked into text shown to a student`, item);

  // ---- editorial doctrine ----
  if (/\b(is legal|illegal|not legal|Legal:)\b/i.test(item.explain))
    fail(`[${item.gen}] legality verdict language -- the screen is MET / NOT MET`, item);
  if (['lowest-layer', 'under-cloud'].includes(item.gen) && !/2,000 ft horizontal/.test(item.explain))
    fail(`[${item.gen}] altitude answer without the 2,000 ft horizontal restatement`, item);
  if (item.gen === 'under-cloud' && !/planning number|only limit left|no altitude/i.test(item.explain))
    fail(`[${item.gen}] under-cloud answer not framed as a conditional planning number`, item);
  if (item.cat === 'Visibility' && !/control station/.test(item.explain))
    fail(`[${item.gen}] visibility item without the site-verification caveat`, item);

  // ---- the report itself ----
  if (!/^METAR K[A-Z]{3} \d{6}Z /.test(item.metar)) fail(`[${item.gen}] malformed report head`, item);
  if (!/ RMK AO2$/.test(item.metar)) fail(`[${item.gen}] malformed report tail`, item);

  const p = parse(item.metar);
  const correct = String(item.choices[item.answer]);

  if (!p.sky.length) fail(`[${item.gen}] no sky group in the generated report`, item);
  if (p.vis === null) fail(`[${item.gen}] no visibility group in the generated report`, item);
  if (p.temp === null) fail(`[${item.gen}] no temperature group in the generated report`, item);

  const layers = p.sky.filter(s => s.ft !== null);
  for (let k = 1; k < layers.length; k++)
    if (layers[k].ft <= layers[k - 1].ft) fail(`[${item.gen}] sky layers do not ascend`, item);
  const ovc = p.sky.findIndex(s => s.cov === 'OVC');
  if (ovc !== -1 && ovc !== p.sky.length - 1) fail(`[${item.gen}] a layer is reported above an overcast deck`, item);
  // Sky cover is reported on a summation basis -- the amount shown for a layer
  // is the total sky covered at and below it -- so it cannot decrease with
  // height. "BKN038 FEW060" is not a report any station transmits.
  const RANK = {FEW: 1, SCT: 2, BKN: 3, OVC: 4, VV: 4};
  for (let k = 1; k < layers.length; k++)
    if (RANK[layers[k].cov] < RANK[layers[k - 1].cov])
      fail(`[${item.gen}] sky cover decreases with height (${layers[k - 1].code} then ${layers[k].code}) -- violates the summation convention`, item);
  if (/FZFG/.test(item.metar) && p.temp > 0) fail(`[${item.gen}] freezing fog reported at ${p.temp} °C`, item);

  // ---- answer re-derived from the regulation ----
  switch (item.gen) {
    case 'ceiling': {
      const want = p.ceiling ? `${nf(p.ceiling.ft)} ft AGL` : 'There is no ceiling in this report';
      if (correct !== want) fail(`[ceiling] marked "${correct}", independently derived "${want}"`, item);
      break;
    }
    case 'lowest-layer': {
      const want = `${p.lowest.code} — ${nf(p.lowest.ft)} ft`;
      if (correct !== want) fail(`[lowest-layer] marked "${correct}", derived "${want}"`, item);
      break;
    }
    case 'under-cloud': {
      // 107.51(d)(1): 500 ft below ANY cloud. 107.51(b): 400 ft AGL cap.
      let want;
      if (!p.lowest) want = '400 ft AGL';
      else {
        const under = Math.max(0, p.lowest.ft - 500);
        want = under === 0
          ? 'No altitude works — that layer leaves nothing underneath'
          : `${nf(Math.min(400, under))} ft AGL`;
      }
      if (correct !== want) fail(`[under-cloud] marked "${correct}", derived "${want}"`, item);
      break;
    }
    case 'visibility-screen': {
      // 107.51(c): 3 statute miles.
      const meets = !(p.visOp === 'less than' || p.vis < 3);
      const want = meets
        ? 'MET — the reported prevailing visibility is 3 SM or more'
        : 'NOT MET — the reported prevailing visibility is below 3 SM';
      if (correct !== want) fail(`[visibility-screen] marked "${correct}", derived "${want}" (vis ${p.vis}, op "${p.visOp}")`, item);
      break;
    }
    case 'visibility-read': {
      if (!/statute mile/.test(correct)) fail(`[visibility-read] marked "${correct}" -- not in statute miles`, item);
      if (/nautical|kilometre|control station/.test(correct)) fail(`[visibility-read] a distractor is marked correct: "${correct}"`, item);
      break;
    }
    case 'zulu-stamp': {
      const hm = String(p.stamp.h).padStart(2, '0') + ':' + String(p.stamp.m).padStart(2, '0');
      if (!correct.includes(hm + ' UTC')) fail(`[zulu-stamp] marked "${correct}", expected ${hm} UTC`, item);
      if (!correct.startsWith('The ' + p.stamp.day)) fail(`[zulu-stamp] day ${p.stamp.day} not named in "${correct}"`, item);
      break;
    }
    case 'zulu-local': {
      const m = item.q.match(/UTC−(\d)/);
      if (!m) { fail('[zulu-local] the stem names no offset', item); break; }
      const off = -(+m[1]);
      const h = ((p.stamp.h + off) % 24 + 24) % 24;
      const want = String(h).padStart(2, '0') + String(p.stamp.m).padStart(2, '0') +
                   ((p.stamp.h + off) < 0 ? ' on the previous day' : '');
      if (correct !== want) fail(`[zulu-local] marked "${correct}", derived "${want}"`, item);
      break;
    }
    case 'spread-value': {
      const want = (p.temp - p.dew) + ' °C';
      if (correct !== want) fail(`[spread-value] marked "${correct}", derived "${want}"`, item);
      if (p.temp - p.dew < 0) fail('[spread-value] dew point above temperature', item);
      break;
    }
    case 'spread-meaning': {
      const spread = p.temp - p.dew;
      const density = /density altitude/i.test(correct);
      if (density && (p.temp < 30 || spread <= 3))
        fail(`[spread-meaning] density-altitude answer at ${p.temp} °C with a ${spread} °C spread`, item);
      if (!density && spread > 3)
        fail(`[spread-meaning] near-saturation answer on a ${spread} °C spread`, item);
      break;
    }
    case 'wind-decode': {
      if (!p.wind) { fail('[wind-decode] no wind group parsed', item); break; }
      if (p.wind.dir === '000') {
        if (!/^Calm/.test(correct)) fail(`[wind-decode] calm report marked "${correct}"`, item);
        if (p.wind.speed !== 0) fail('[wind-decode] direction 000 with a non-zero speed', item);
      } else if (p.wind.dir === 'VRB') {
        if (correct !== `Variable in direction at ${p.wind.speed} kt`)
          fail(`[wind-decode] VRB${p.wind.speed} marked "${correct}"`, item);
      } else {
        const dir = +p.wind.dir;
        if (dir === 0) fail('[wind-decode] direction coded 000 with wind blowing', item);
        // METAR wind is FROM the given direction, referenced to TRUE north.
        if (!correct.startsWith(`From ${dir}° true at ${p.wind.speed} kt`))
          fail(`[wind-decode] ${p.wind.dir}${p.wind.speed} marked "${correct}"`, item);
        if (p.wind.gust) {
          if (!correct.includes(`gusting to ${p.wind.gust} kt`)) fail(`[wind-decode] gust missing from "${correct}"`, item);
          if (p.wind.gust <= p.wind.speed) fail('[wind-decode] gust not above the sustained speed', item);
        }
        if (p.wind.vlo !== undefined && !correct.includes(`${p.wind.vlo}° and ${p.wind.vhi}°`))
          fail(`[wind-decode] variable-direction range missing from "${correct}"`, item);
      }
      break;
    }
    default:
      fail(`unknown template id "${item.gen}" -- add a re-derivation for it here`, item);
  }

  seen.add(item.metar + '||' + item.q);
}

const templates = Object.keys(perTemplate).length;
const repeats = N - seen.size;

console.log('\n--- PASSED ---');
console.log(`  EXAM_GEN: ${EXAM_GEN.templates.length} templates, ${N} items generated and re-derived`);
console.log(`  coverage: ${templates}/${EXAM_GEN.templates.length} templates exercised`);
console.log(`  ${JSON.stringify(perTemplate)}`);
console.log(`  identical (report + question) pairs across the run: ${repeats}`);

if (templates !== EXAM_GEN.templates.length)
  errors.push(`only ${templates} of ${EXAM_GEN.templates.length} templates were exercised -- raise the count`);
if (external)
  errors.push(`EXAM_GEN references "${external[1]}" outside itself -- it must stay self-contained`);
// A generator that repeats itself is the bug this module exists to fix.
if (repeats > N * 0.01)
  errors.push(`${repeats} repeated items in ${N} draws -- the generator is not varying enough`);

if (errors.length) {
  console.log('\n--- FAILED ---');
  errors.forEach(e => console.log('  ' + e));
  process.exit(1);
}
console.log('\nAll generated exam item checks passed.');
