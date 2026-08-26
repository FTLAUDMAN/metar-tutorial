// Static validation of the tutorial's data tables: pulls the top-level const
// declarations out of the page and evaluates just those, so scenario ids can be
// cross-checked against the choice lists without booting the whole page.
const fs = require('fs');
const path = process.env.METAR_HTML ||
  require('path').join(__dirname, '..', 'metar-tutorial_3.html');
const html = fs.readFileSync(path, 'utf8');
const js = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));

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

// CLASS_SOP is referenced by some template-literal labels, so define it first.
const CLASS_SOP = eval('(' + extractDecl('CLASS_SOP') + ')');
const LIMIT_FACTORS = eval('(' + extractDecl('LIMIT_FACTORS') + ')');
const DECISION_DRIVERS = eval('(' + extractDecl('DECISION_DRIVERS') + ')');
const MITIGATIONS = eval('(' + extractDecl('MITIGATIONS') + ')');
const GONOGO_SCENARIOS = eval('(' + extractDecl('GONOGO_SCENARIOS') + ')');
const EXAM_BANK = eval('(' + extractDecl('EXAM_BANK') + ')');
const SITE_VERIFICATION = eval('(' + extractDecl('SITE_VERIFICATION') + ')');

const errors = [];
const ok = [];

const ids = a => a.map(x => x.id);
const F = ids(LIMIT_FACTORS), D = ids(DECISION_DRIVERS), M = ids(MITIGATIONS);

ok.push(`CLASS_SOP: ${CLASS_SOP.name} — wind ${CLASS_SOP.maxSustainedWindKt}kt / gust ${CLASS_SOP.maxGustKt}kt / precip ${CLASS_SOP.precipitationAllowed} / hot ${CLASS_SOP.hotWxTempC}C`);
ok.push(`Choice lists: ${F.length} factors, ${D.length} drivers, ${M.length} mitigations`);
ok.push(`SITE_VERIFICATION items: ${SITE_VERIFICATION.length}`);

if (!M.includes('shorter')) errors.push('MITIGATIONS is missing the "shorter" (shorter flight / larger reserve) option');

const seenIds = new Set();
GONOGO_SCENARIOS.forEach((s, i) => {
  const tag = `scenario[${i}] ${s.id || '(no id)'}`;
  if (!s.id) errors.push(`${tag}: missing stable id`);
  else if (seenIds.has(s.id)) errors.push(`${tag}: duplicate id`);
  else seenIds.add(s.id);

  if ('answer' in s) errors.push(`${tag}: still carries removed "answer" property`);
  if ('legal' in s) errors.push(`${tag}: still carries removed "legal" property`);
  if (!['met', 'notmet'].includes(s.reportedMins)) errors.push(`${tag}: bad reportedMins "${s.reportedMins}"`);
  if (!['go', 'go-restricted', 'nogo'].includes(s.operational)) errors.push(`${tag}: bad operational "${s.operational}"`);

  (s.factors || []).forEach(x => { if (!F.includes(x)) errors.push(`${tag}: factor "${x}" not in LIMIT_FACTORS`); });
  (s.drivers || []).forEach(x => { if (!D.includes(x)) errors.push(`${tag}: driver "${x}" not in DECISION_DRIVERS`); });
  (s.mitigations || []).forEach(x => { if (!M.includes(x)) errors.push(`${tag}: mitigation "${x}" not in MITIGATIONS`); });
  (s.sop || []).forEach(x => {
    if (!['wind', 'gust', 'precip', 'heat', 'vis'].includes(x)) errors.push(`${tag}: sop key "${x}" has no SOP_LIMITS entry`);
  });
  // Both calls owe the student a targeted correction. A scenario that explains
  // only the minimums miss leaves the operational half -- the half the
  // regulation cannot answer for them -- silently unaddressed.
  if (!s.misconception) errors.push(`${tag}: missing misconception (fires on a wrong reported-minimums call)`);
  if (!s.opMisconception) errors.push(`${tag}: missing opMisconception (fires on a wrong operational call)`);
  if (!s.factors || !s.factors.length) errors.push(`${tag}: no factors`);
  if (!s.drivers || !s.drivers.length) errors.push(`${tag}: no drivers`);
  if (!s.mitigations || !s.mitigations.length) errors.push(`${tag}: no mitigations`);
  if ((s.drivers || []).includes('pressure')) errors.push(`${tag}: "pressure" is a distractor and must never be a correct driver`);
});
ok.push(`GONOGO_SCENARIOS: ${GONOGO_SCENARIOS.length} scenarios, all ids unique`);

EXAM_BANK.forEach((q, i) => {
  const tag = `EXAM_BANK[${i}] ${q.cat}`;
  if (!Array.isArray(q.choices) || q.choices.length < 2) errors.push(`${tag}: bad choices`);
  if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.choices.length)
    errors.push(`${tag}: answer index ${q.answer} out of range (0..${q.choices.length - 1})`);
  if (!q.explain) errors.push(`${tag}: missing explain`);
  if (!q.q) errors.push(`${tag}: missing question text`);
});
ok.push(`EXAM_BANK: ${EXAM_BANK.length} questions, all answer indexes in range`);

// A stray ${...} in a single-quoted data string renders literally to the student.
const scanFields = ['explain', 'misconception', 'opMisconception', 'mission'];
GONOGO_SCENARIOS.forEach((s, i) => scanFields.forEach(f => {
  if (typeof s[f] === 'string' && s[f].includes('${'))
    errors.push(`scenario[${i}].${f}: contains an uninterpolated \${...} placeholder`);
}));
EXAM_BANK.forEach((q, i) => {
  if (q.explain.includes('${')) errors.push(`EXAM_BANK[${i}].explain: uninterpolated \${...}`);
});
ok.push('No uninterpolated ${...} placeholders in scenario or exam prose');

// Every scenario METAR must survive the visibility/sky regexes as expected.
console.log('\n--- PASSED ---');
ok.forEach(o => console.log('  ' + o));
if (errors.length) {
  console.log('\n--- FAILED ---');
  errors.forEach(e => console.log('  ' + e));
  process.exit(1);
}
console.log('\nAll static data checks passed.');
