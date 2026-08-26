// Scenario regression harness. Loads the real parser and the real
// reportedMinimumsStatus / sopFindings out of the page (no DOM needed for any
// of them) and checks that every hand-authored verdict agrees with what the
// code actually computes for that METAR.
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
  slice('const GONOGO_SCENARIOS = [', '(function initGoNoGo')
].join('\n');

const ctx = {};
(new Function('exports', src + '\nexports.parseMETAR=parseMETAR;exports.reportedMinimumsStatus=reportedMinimumsStatus;exports.sopFindings=sopFindings;exports.GONOGO_SCENARIOS=GONOGO_SCENARIOS;exports.CLASS_SOP=CLASS_SOP;'))(ctx);

const { parseMETAR, reportedMinimumsStatus, sopFindings, GONOGO_SCENARIOS, CLASS_SOP } = ctx;

let fails = 0;
console.log('SCENARIO REGRESSION — reported-minimums screen vs. authored verdict\n');
console.log('id                 | authored | computed | vis    | lowest layer | plan  | SOP findings');
console.log('-------------------+----------+----------+--------+--------------+-------+-------------');
GONOGO_SCENARIOS.forEach(s => {
  const { meta } = parseMETAR(s.metar);
  const rm = reportedMinimumsStatus(meta);
  const plan = meta.lowestLayerFt !== null ? Math.min(400, Math.max(0, meta.lowestLayerFt - 500)) : 400;
  const sop = sopFindings(meta);
  const agree = rm.status === s.reportedMins;
  if (!agree) fails++;
  const layer = meta.lowestLayerFt !== null ? `${meta.lowestLayerCov}${String(meta.lowestLayerFt / 100).padStart(3, '0')} ${meta.lowestLayerFt}ft` : 'none';
  console.log(
    `${s.id.padEnd(18)} | ${s.reportedMins.padEnd(8)} | ${rm.status.padEnd(8)} | ${String(meta.visibilityMiles).padEnd(6)} | ${layer.padEnd(12)} | ${String(plan).padEnd(5)} | ${sop.length}` +
    (agree ? '' : '   <== MISMATCH')
  );
});

console.log('\nDETAIL\n');
GONOGO_SCENARIOS.forEach(s => {
  const { meta } = parseMETAR(s.metar);
  const sop = sopFindings(meta);
  console.log(`${s.id}  [reported ${s.reportedMins} / operational ${s.operational}]`);
  console.log(`   factors=${s.factors.join(',')}  drivers=${s.drivers.join(',')}  mitigations=${s.mitigations.join(',')}  sopShown=${(s.sop || []).join(',') || '(none)'}`);
  console.log(`   wind=${meta.windSpeedKt}kt gust=${meta.windGustKt} precip=${meta.hasPrecip} ts=${meta.hasThunderstorm} obsc=${meta.hasObscuration} temp=${meta.tempC}C`);
  sop.forEach(f => console.log(`   SOP: ${f.replace(/<[^>]+>/g, '')}`));
  console.log('');
});

// The operational verdict must be consistent with the profile: any SOP breach
// (wind, gust, precipitation) has to force a NO-GO, and the heat threshold has
// to force at least a restriction.
console.log('OPERATIONAL VERDICT vs. CLASS_SOP\n');
GONOGO_SCENARIOS.forEach(s => {
  const { meta } = parseMETAR(s.metar);
  const hardBreach =
    (meta.windSpeedKt !== null && meta.windSpeedKt > CLASS_SOP.maxSustainedWindKt) ||
    (meta.windGustKt !== null && meta.windGustKt > CLASS_SOP.maxGustKt) ||
    (!CLASS_SOP.precipitationAllowed && meta.hasPrecip) ||
    meta.hasThunderstorm ||
    s.reportedMins === 'notmet';
  const softBreach = meta.tempC !== null && meta.tempC >= CLASS_SOP.hotWxTempC;
  let expected;
  if (hardBreach) expected = 'nogo';
  else if (softBreach) expected = 'go-restricted';
  else expected = null; // judgement call — restriction or clean go both defensible
  if (expected && s.operational !== expected) {
    console.log(`  MISMATCH ${s.id}: authored "${s.operational}", profile implies "${expected}"`);
    fails++;
  } else {
    console.log(`  ok ${s.id.padEnd(18)} authored "${s.operational}"${expected ? ` (profile implies "${expected}")` : ' (judgement call)'}`);
  }
});

console.log(fails ? `\n${fails} MISMATCH(ES)` : '\nAll scenario regressions agree.');
process.exit(fails ? 1 : 0);
