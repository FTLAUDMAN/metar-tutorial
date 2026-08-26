// What Changed regression: each pair's authored operational answer must be
// consistent with the reported numbers and the classroom profile.
const fs = require('fs');
const path = process.env.METAR_HTML ||
  require('path').join(__dirname, '..', 'metar-tutorial_3.html');
const html = fs.readFileSync(path, 'utf8');
const js = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));

function slice(fromMarker, toMarker) {
  const a = js.indexOf(fromMarker);
  const b = js.indexOf(toMarker, a);
  if (a < 0 || b < 0) throw new Error('slice failed: ' + fromMarker);
  return js.slice(a, b);
}

const src = [
  slice('const CLASS_SOP = {', 'function sopCardHtml'),
  slice('function reportedMinimumsStatus(meta){', '/* ========================================================================='),
  slice('const WX_DESCRIPTORS', 'function fieldClass(type)'),
  '  const PAIRS = ' + slice('  const PAIRS = [', '\n  let currentPair = 0;').slice('  const PAIRS = '.length)
].join('\n');

const ctx = {};
(new Function('exports', src + '\nexports.parseMETAR=parseMETAR;exports.reportedMinimumsStatus=reportedMinimumsStatus;exports.sopFindings=sopFindings;exports.PAIRS=PAIRS;exports.CLASS_SOP=CLASS_SOP;'))(ctx);
const { parseMETAR, reportedMinimumsStatus, sopFindings, PAIRS, CLASS_SOP } = ctx;

let fails = 0;
const seen = new Set();
console.log('WHAT CHANGED REGRESSION — later report vs. authored answer\n');
PAIRS.forEach(p => {
  if (!p.id) { console.log('  MISSING ID on a pair'); fails++; return; }
  if (seen.has(p.id)) { console.log('  DUPLICATE ID ' + p.id); fails++; }
  seen.add(p.id);

  const before = parseMETAR(p.before).meta;
  const after = parseMETAR(p.after).meta;
  const rmB = reportedMinimumsStatus(before).status;
  const rmA = reportedMinimumsStatus(after).status;

  const hard =
    rmA === 'notmet' ||
    after.hasThunderstorm ||
    (after.windSpeedKt !== null && after.windSpeedKt > CLASS_SOP.maxSustainedWindKt) ||
    (after.windGustKt !== null && after.windGustKt > CLASS_SOP.maxGustKt) ||
    (!CLASS_SOP.precipitationAllowed && after.hasPrecip);
  const soft = after.tempC !== null && after.tempC >= CLASS_SOP.hotWxTempC;
  const expected = hard ? 'nogo' : soft ? 'caution' : null;

  const agree = !expected || expected === p.answer;
  if (!agree) fails++;
  console.log(
    `${p.id.padEnd(20)} earlier=${rmB.padEnd(6)} later=${rmA.padEnd(6)} ` +
    `later: vis=${String(after.visibilityMiles).padEnd(4)} gust=${String(after.windGustKt).padEnd(4)} ts=${after.hasThunderstorm ? 'Y' : 'n'} precip=${after.hasPrecip ? 'Y' : 'n'} temp=${after.tempC}C`
  );
  console.log(`${''.padEnd(20)} authored answer="${p.answer}"  profile implies="${expected || 'judgement call'}"${agree ? '' : '   <== MISMATCH'}`);
  const findings = sopFindings(after);
  findings.forEach(f => console.log(`${''.padEnd(20)}   SOP: ${f.replace(/<[^>]+>/g, '')}`));
  console.log('');
});

console.log(fails ? `${fails} MISMATCH(ES)` : `All ${PAIRS.length} What Changed pairs agree, all ids unique.`);
process.exit(fails ? 1 : 0);
