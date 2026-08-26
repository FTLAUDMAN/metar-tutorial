// Checks the CONCEPTS table against the things it claims to route between.
//
// CONCEPTS is the join between three systems that do not otherwise know about
// each other: the exam's per-category accuracy weights, the spaced-practice
// schedule, and the page's section anchors. Every one of its failure modes is
// silent at runtime --
//
//   * an id that does not match an exam category never accumulates accuracy,
//     so the concept can never be reported as weak;
//   * an href that names no element scrolls nowhere when a student clicks the
//     dashboard's one instruction;
//   * a category the exam can actually produce but CONCEPTS omits is tracked
//     and then never surfaced.
//
// None of that throws, so none of it shows up in the other checkers.
//
//   node regress_concepts.js

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

const CONCEPTS = eval('(' + extractDecl('CONCEPTS') + ')');
const EXAM_BANK = eval('(' + extractDecl('EXAM_BANK') + ')');
const EXAM_GEN = eval('(' + extractDecl('EXAM_GEN') + ')');

const errors = [];
const ok = [];

// Categories the exam can actually score, from both halves of the bank.
const examCats = new Set([
  ...EXAM_BANK.map(q => q.cat),
  ...EXAM_GEN.templates.map(t => t.cat),
]);

// Concepts scored somewhere other than the exam. These legitimately have no
// exam category -- but the list is explicit so a typo cannot hide in it.
const NON_EXAM = new Set(['Go / No-Go']);

const ids = new Set();
CONCEPTS.forEach((c, i) => {
  const tag = `CONCEPTS[${i}] ${c.id || '(no id)'}`;
  if (!c.id) errors.push(`${tag}: missing id`);
  else if (ids.has(c.id)) errors.push(`${tag}: duplicate id`);
  else ids.add(c.id);

  if (!c.label) errors.push(`${tag}: missing label`);
  if (!c.cta) errors.push(`${tag}: missing cta`);

  // The label is dropped into "Practise <label>" and "practised <label>", so a
  // capitalised one reads as a sentence fragment mid-sentence.
  if (c.label && /^[A-Z]/.test(c.label) && !/^(METAR|Zulu)/.test(c.label))
    errors.push(`${tag}: label "${c.label}" is capitalised; it appears mid-sentence`);

  if (!c.href || !c.href.startsWith('#')) {
    errors.push(`${tag}: href "${c.href}" is not a fragment link`);
  } else {
    const target = c.href.slice(1);
    // The anchor has to exist, or the dashboard's one instruction goes nowhere.
    const re = new RegExp('id=["\']' + target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '["\']');
    if (!re.test(html)) errors.push(`${tag}: href "${c.href}" names no element on the page`);
  }

  if (!NON_EXAM.has(c.id) && !examCats.has(c.id))
    errors.push(`${tag}: id is not an exam category, so it can never accumulate accuracy ` +
                `(exam categories: ${[...examCats].sort().join(', ')})`);
});

// The reverse direction: a category the exam scores but nothing routes to.
examCats.forEach(cat => {
  if (!ids.has(cat)) errors.push(`exam category "${cat}" has no CONCEPTS entry, so it is tracked but never recommended`);
});

ok.push(`CONCEPTS: ${CONCEPTS.length} entries, all ids unique`);
ok.push(`Exam categories covered: ${[...examCats].sort().join(', ')}`);
ok.push(`Non-exam concepts: ${[...NON_EXAM].join(', ')}`);
ok.push('Every href resolves to an element on the page');

console.log('\n--- PASSED ---');
ok.forEach(o => console.log('  ' + o));
if (errors.length) {
  console.log('\n--- FAILED ---');
  errors.forEach(e => console.log('  ' + e));
  process.exit(1);
}
console.log('\nAll concept-routing checks passed.');
