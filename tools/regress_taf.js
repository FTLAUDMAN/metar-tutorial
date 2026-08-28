// TAF parser regression harness. Feeds hand-annotated TAFs through parseTAF()
// and checks that every period's fields match expectations. Also tests the
// temporal resolution functions (conditionsAt, conditionsDuring) and a
// cross-midnight arithmetic fuzzer.
//
//   node regress_taf.js [fuzz-count]    (default 1000)

'use strict';

const { parseTAF, conditionsAt, conditionsDuring, toMinutes,
  matchWeatherToken, decodeSkyToken, decodeVisibility } =
  require('./taf_parser');

let fails = 0;
let passes = 0;

function assert(cond, msg) {
  if (!cond) { console.log('  FAIL: ' + msg); fails++; }
  else passes++;
}

function assertEq(actual, expected, label) {
  if (actual !== expected) {
    console.log(`  FAIL: ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    fails++;
  } else passes++;
}

function assertApprox(actual, expected, tolerance, label) {
  if (Math.abs(actual - expected) > tolerance) {
    console.log(`  FAIL: ${label}: expected ~${expected}, got ${actual}`);
    fails++;
  } else passes++;
}

// ============================================================================
// Section 1: Parser regression — hand-annotated TAFs
// ============================================================================

console.log('TAF PARSER REGRESSION\n');
console.log('Section 1: Hand-annotated TAF parsing\n');

const CASES = [
  {
    name: 'Standard US TAF with FM groups',
    raw: 'TAF KXNA 141130Z 1412/1512 18008KT P6SM SKC FM141800 21015G25KT 3SM TSRA BKN020CB FM150000 27008KT P6SM SCT040',
    expect: {
      station: 'KXNA',
      amendment: null,
      issued: { day: 14, hour: 11, min: 30 },
      validity: { startDay: 14, startHour: 12, endDay: 15, endHour: 12 },
      periodCount: 3,
      periods: [
        { type: 'INITIAL', windKt: 8, gustKt: null, visMi: 6, visOp: 'greater than',
          layers: ['SKC'], ceiling: null, ts: false, precip: false },
        { type: 'FM', startDay: 14, startHour: 18, windKt: 15, gustKt: 25,
          visMi: 3, layers: ['BKN020CB'], ceiling: 2000, ts: true, precip: true },
        { type: 'FM', startDay: 15, startHour: 0, windKt: 8, gustKt: null,
          visMi: 6, visOp: 'greater than', layers: ['SCT040'], ceiling: null }
      ]
    }
  },
  {
    name: 'AMD qualifier',
    raw: 'TAF AMD KJFK 201730Z 2018/2118 33015G25KT P6SM BKN025',
    expect: {
      station: 'KJFK',
      amendment: 'AMD',
      validity: { startDay: 20, startHour: 18, endDay: 21, endHour: 18 },
      periodCount: 1,
      periods: [
        { type: 'INITIAL', windKt: 15, gustKt: 25, visMi: 6, visOp: 'greater than',
          layers: ['BKN025'], ceiling: 2500 }
      ]
    }
  },
  {
    name: 'COR qualifier',
    raw: 'TAF COR KORD 051140Z 0512/0612 27010KT P6SM FEW250',
    expect: {
      station: 'KORD',
      amendment: 'COR',
      periodCount: 1,
      periods: [
        { type: 'INITIAL', windKt: 10, gustKt: null, visMi: 6, layers: ['FEW250'] }
      ]
    }
  },
  {
    name: 'BECMG group',
    raw: 'TAF KSFO 101730Z 1018/1118 28012KT P6SM SCT015 BKN025 BECMG 1100/1103 32008KT P6SM FEW020 SCT200',
    expect: {
      station: 'KSFO',
      periodCount: 2,
      periods: [
        { type: 'INITIAL', windKt: 12, layers: ['SCT015', 'BKN025'], ceiling: 2500 },
        { type: 'BECMG', startDay: 11, startHour: 0, endDay: 11, endHour: 3,
          windKt: 8, layers: ['FEW020', 'SCT200'], ceiling: null }
      ]
    }
  },
  {
    name: 'TEMPO group',
    raw: 'TAF KDEN 081130Z 0812/0912 22010KT P6SM SCT060 TEMPO 0816/0820 4SM TSRA BKN030CB',
    expect: {
      station: 'KDEN',
      periodCount: 2,
      periods: [
        { type: 'INITIAL', windKt: 10, visMi: 6, layers: ['SCT060'] },
        { type: 'TEMPO', startDay: 8, startHour: 16, endDay: 8, endHour: 20,
          visMi: 4, ts: true, precip: true, layers: ['BKN030CB'], ceiling: 3000 }
      ]
    }
  },
  {
    name: 'PROB40 TEMPO',
    raw: 'TAF KATL 121730Z 1218/1318 18008KT P6SM SCT030 PROB40 TEMPO 1302/1306 2SM BR OVC010',
    expect: {
      station: 'KATL',
      periodCount: 2,
      periods: [
        { type: 'INITIAL', windKt: 8, visMi: 6, layers: ['SCT030'] },
        { type: 'TEMPO', startDay: 13, startHour: 2, endDay: 13, endHour: 6,
          prob: 40, visMi: 2, layers: ['OVC010'], ceiling: 1000,
          hasObscuration: true }
      ]
    }
  },
  {
    name: 'PROB30 standalone',
    raw: 'TAF KMIA 151130Z 1512/1612 VRB05KT P6SM SCT025 PROB30 1518/1522 1SM TSRA OVC015CB',
    expect: {
      station: 'KMIA',
      periodCount: 2,
      periods: [
        { type: 'INITIAL', windKt: 5, visMi: 6 },
        { type: 'PROB', startDay: 15, startHour: 18, endDay: 15, endHour: 22,
          prob: 30, visMi: 1, ts: true, precip: true, ceiling: 1500 }
      ]
    }
  },
  {
    name: 'NSW — no significant weather',
    raw: 'TAF KPHX 201130Z 2012/2112 24008KT P6SM FEW100 FM201800 30015KT P6SM NSW SKC',
    expect: {
      station: 'KPHX',
      periodCount: 2,
      periods: [
        { type: 'INITIAL', windKt: 8 },
        { type: 'FM', startDay: 20, startHour: 18, windKt: 15, hasNSW: true,
          layers: ['SKC'] }
      ]
    }
  },
  {
    name: 'Calm winds (00000KT)',
    raw: 'TAF KBNA 101130Z 1012/1112 00000KT P6SM CLR',
    expect: {
      station: 'KBNA',
      periodCount: 1,
      periods: [
        { type: 'INITIAL', windKt: 0, gustKt: null, visMi: 6, layers: ['CLR'] }
      ]
    }
  },
  {
    name: 'VRB wind in TAF',
    raw: 'TAF KLAS 081730Z 0818/0918 VRB06KT P6SM FEW120',
    expect: {
      station: 'KLAS',
      periodCount: 1,
      periods: [
        { type: 'INITIAL', windDir: 'VRB', windKt: 6 }
      ]
    }
  },
  {
    name: 'Multiple FM + TEMPO combination',
    raw: 'TAF KIAD 151130Z 1512/1612 18010KT P6SM SCT040 FM151800 24015G28KT 5SM -RA BKN020 TEMPO 1518/1522 2SM TSRA OVC010CB FM160200 31010KT P6SM SCT050',
    expect: {
      station: 'KIAD',
      periodCount: 4,
      periods: [
        { type: 'INITIAL', windKt: 10, visMi: 6 },
        { type: 'FM', startDay: 15, startHour: 18, windKt: 15, gustKt: 28,
          visMi: 5, precip: true },
        { type: 'TEMPO', startDay: 15, startHour: 18, endDay: 15, endHour: 22,
          visMi: 2, ts: true, ceiling: 1000 },
        { type: 'FM', startDay: 16, startHour: 2, windKt: 10, visMi: 6 }
      ]
    }
  },
  {
    name: 'Cross-midnight validity (30th to 1st)',
    raw: 'TAF KLAX 301730Z 3018/0118 25010KT P6SM SCT025 FM010200 VRB03KT P6SM CLR',
    expect: {
      station: 'KLAX',
      validity: { startDay: 30, startHour: 18, endDay: 1, endHour: 18 },
      periodCount: 2,
      periods: [
        { type: 'INITIAL', windKt: 10 },
        { type: 'FM', startDay: 1, startHour: 2, windKt: 3 }
      ]
    }
  },
  {
    name: 'Multiple weather phenomena',
    raw: 'TAF KMSN 071130Z 0712/0812 20012KT 3SM -SNBR BKN010 OVC020',
    expect: {
      station: 'KMSN',
      periodCount: 1,
      periods: [
        { type: 'INITIAL', windKt: 12, visMi: 3, ceiling: 1000,
          precip: true, hasObscuration: true, layers: ['BKN010', 'OVC020'] }
      ]
    }
  },
  {
    name: 'Vertical visibility (VV)',
    raw: 'TAF KSEA 091730Z 0918/1018 17008KT 1/2SM FG VV002',
    expect: {
      station: 'KSEA',
      periodCount: 1,
      periods: [
        { type: 'INITIAL', windKt: 8, visMi: 0.5, ceiling: 200,
          hasObscuration: true, layers: ['VV002'] }
      ]
    }
  },
  {
    name: '30-hour TAF validity',
    raw: 'TAF KJFK 051130Z 0512/0618 20010KT P6SM SCT250',
    expect: {
      station: 'KJFK',
      validity: { startDay: 5, startHour: 12, endDay: 6, endHour: 18 },
      periodCount: 1
    }
  },
  {
    name: 'Fractional visibility',
    raw: 'TAF KORD 071130Z 0712/0812 18005KT 1 1/2SM BR OVC005',
    expect: {
      station: 'KORD',
      periodCount: 1,
      periods: [
        { type: 'INITIAL', windKt: 5, visMi: 1.5, ceiling: 500,
          hasObscuration: true }
      ]
    }
  },
  {
    name: 'Multiple sky layers with summation',
    raw: 'TAF KDFW 101730Z 1018/1118 18012KT P6SM FEW035 SCT060 BKN120',
    expect: {
      station: 'KDFW',
      periodCount: 1,
      periods: [
        { type: 'INITIAL', windKt: 12, lowestFt: 3500, lowestCov: 'FEW',
          ceiling: 12000, layers: ['FEW035', 'SCT060', 'BKN120'] }
      ]
    }
  },
  {
    name: 'CB and TCU in sky groups',
    raw: 'TAF KIAH 121130Z 1212/1312 18010KT P6SM SCT040TCU BKN080',
    expect: {
      station: 'KIAH',
      periodCount: 1,
      periods: [
        { type: 'INITIAL', windKt: 10, visMi: 6, lowestFt: 4000,
          ceiling: 8000, layerTypes: [{ cov: 'SCT', feet: 4000, type: 'TCU' },
                                      { cov: 'BKN', feet: 8000, type: null }] }
      ]
    }
  },
  {
    name: 'BECMG followed by FM',
    raw: 'TAF KBOS 081730Z 0818/0918 02015KT P6SM OVC015 BECMG 0822/0824 36010KT OVC025 FM090400 VRB05KT P6SM SCT050',
    expect: {
      station: 'KBOS',
      periodCount: 3,
      periods: [
        { type: 'INITIAL', windKt: 15, ceiling: 1500 },
        { type: 'BECMG', startDay: 8, startHour: 22, endDay: 8, endHour: 24,
          windKt: 10, ceiling: 2500 },
        { type: 'FM', startDay: 9, startHour: 4, windKt: 5, visMi: 6 }
      ]
    }
  },
  {
    name: 'Heavy weather intensity in TAF',
    raw: 'TAF KMCO 151130Z 1512/1612 18008KT P6SM SCT035 FM151800 22012KT 2SM +TSRA BKN015CB',
    expect: {
      station: 'KMCO',
      periodCount: 2,
      periods: [
        { type: 'INITIAL', windKt: 8, ts: false },
        { type: 'FM', startDay: 15, startHour: 18, windKt: 12, visMi: 2,
          ts: true, precip: true, ceiling: 1500 }
      ]
    }
  },
];

CASES.forEach(tc => {
  console.log(`  ${tc.name}`);
  const taf = parseTAF(tc.raw);
  const ex = tc.expect;

  assert(!taf.error, `parse error: ${taf.error}`);
  if (ex.station) assertEq(taf.station, ex.station, 'station');
  if (ex.amendment !== undefined) assertEq(taf.amendment, ex.amendment, 'amendment');
  if (ex.issued) {
    assertEq(taf.issued.day, ex.issued.day, 'issued.day');
    assertEq(taf.issued.hour, ex.issued.hour, 'issued.hour');
    assertEq(taf.issued.min, ex.issued.min, 'issued.min');
  }
  if (ex.validity) {
    assertEq(taf.validity.startDay, ex.validity.startDay, 'validity.startDay');
    assertEq(taf.validity.startHour, ex.validity.startHour, 'validity.startHour');
    assertEq(taf.validity.endDay, ex.validity.endDay, 'validity.endDay');
    assertEq(taf.validity.endHour, ex.validity.endHour, 'validity.endHour');
  }
  if (ex.periodCount !== undefined) {
    assertEq(taf.periods.length, ex.periodCount, 'period count');
  }

  if (ex.periods) {
    ex.periods.forEach((ep, pi) => {
      if (pi >= taf.periods.length) {
        assert(false, `period[${pi}] missing`);
        return;
      }
      const p = taf.periods[pi];
      const tag = `period[${pi}]`;

      assertEq(p.type, ep.type, tag + '.type');
      if (ep.startDay !== undefined) assertEq(p.startDay, ep.startDay, tag + '.startDay');
      if (ep.startHour !== undefined) assertEq(p.startHour, ep.startHour, tag + '.startHour');
      if (ep.endDay !== undefined) assertEq(p.endDay, ep.endDay, tag + '.endDay');
      if (ep.endHour !== undefined) assertEq(p.endHour, ep.endHour, tag + '.endHour');
      if (ep.prob !== undefined) assertEq(p.prob, ep.prob, tag + '.prob');

      const m = p.meta;
      if (ep.windDir !== undefined) assertEq(m.windDir, ep.windDir, tag + '.windDir');
      if (ep.windKt !== undefined) assertEq(m.windSpeedKt, ep.windKt, tag + '.windKt');
      if (ep.gustKt !== undefined) assertEq(m.windGustKt, ep.gustKt, tag + '.gustKt');
      if (ep.visMi !== undefined) {
        assertApprox(m.visibilityMiles, ep.visMi, 0.01, tag + '.visMi');
      }
      if (ep.visOp !== undefined) assertEq(m.visibilityOp, ep.visOp, tag + '.visOp');
      if (ep.ceiling !== undefined) assertEq(m.ceilingFt, ep.ceiling, tag + '.ceiling');
      if (ep.lowestFt !== undefined) assertEq(m.lowestLayerFt, ep.lowestFt, tag + '.lowestFt');
      if (ep.lowestCov !== undefined) assertEq(m.lowestLayerCov, ep.lowestCov, tag + '.lowestCov');
      if (ep.ts !== undefined) assertEq(m.hasThunderstorm, ep.ts, tag + '.ts');
      if (ep.precip !== undefined) assertEq(m.hasPrecip, ep.precip, tag + '.precip');
      if (ep.hasObscuration !== undefined) assertEq(m.hasObscuration, ep.hasObscuration, tag + '.hasObscuration');
      if (ep.hasNSW !== undefined) assertEq(m.hasNSW, ep.hasNSW, tag + '.hasNSW');

      if (ep.layers) {
        const actualLayers = m.layers.map(l => l.raw);
        assertEq(actualLayers.join(' '), ep.layers.join(' '), tag + '.layers');
      }
      if (ep.layerTypes) {
        ep.layerTypes.forEach((lt, li) => {
          if (li >= m.layers.length) {
            assert(false, `${tag}.layer[${li}] missing`);
            return;
          }
          assertEq(m.layers[li].cov, lt.cov, `${tag}.layer[${li}].cov`);
          assertEq(m.layers[li].feet, lt.feet, `${tag}.layer[${li}].feet`);
          assertEq(m.layers[li].type, lt.type, `${tag}.layer[${li}].type`);
        });
      }
    });
  }
  console.log('');
});

// ============================================================================
// Section 2: Temporal resolution tests — conditionsAt()
// ============================================================================

console.log('\nSection 2: Temporal resolution (conditionsAt)\n');

{
  const taf = parseTAF(
    'TAF KXNA 141130Z 1412/1512 18008KT P6SM SKC ' +
    'FM141800 21015G25KT 3SM TSRA BKN020CB ' +
    'TEMPO 1420/1424 1SM +TSRA OVC010CB ' +
    'FM150000 27008KT P6SM SCT040'
  );
  assert(!taf.error, 'parse error: ' + taf.error);

  // At 1400Z on the 14th — initial conditions
  const c1 = conditionsAt(taf, 14, 14);
  assert(c1 !== null, '1400Z should be in validity');
  assertEq(c1.base.type, 'INITIAL', '1400Z base is INITIAL');
  assertEq(c1.base.meta.windSpeedKt, 8, '1400Z wind 8kt');
  assertEq(c1.overlays.length, 0, '1400Z no overlays');

  // At 1900Z on the 14th — FM group active, inside TEMPO window
  const c2 = conditionsAt(taf, 19, 14);
  assert(c2 !== null, '1900Z should be in validity');
  assertEq(c2.base.type, 'FM', '1900Z base is FM');
  assertEq(c2.base.meta.windSpeedKt, 15, '1900Z wind 15kt');
  assertEq(c2.base.meta.hasThunderstorm, true, '1900Z TS in base');

  // At 2100Z on the 14th — FM group, inside TEMPO window
  const c3 = conditionsAt(taf, 21, 14);
  assertEq(c3.base.type, 'FM', '2100Z base is FM');
  assertEq(c3.overlays.length, 1, '2100Z has TEMPO overlay');
  assertEq(c3.overlays[0].type, 'TEMPO', '2100Z overlay is TEMPO');
  assertEq(c3.overlays[0].meta.visibilityMiles, 1, '2100Z TEMPO vis 1SM');

  // At 0100Z on the 15th — last FM group
  const c4 = conditionsAt(taf, 1, 15);
  assert(c4 !== null, '0100Z should be in validity');
  assertEq(c4.base.type, 'FM', '0100Z base is FM (last)');
  assertEq(c4.base.meta.windSpeedKt, 8, '0100Z wind 8kt');
  assertEq(c4.overlays.length, 0, '0100Z no overlays');

  // At 1200Z on the 15th — at the exact end of validity, should return null
  const c5 = conditionsAt(taf, 12, 15);
  assertEq(c5, null, '1200Z on 15th is at validity end (exclusive)');

  // Before validity
  const c6 = conditionsAt(taf, 11, 14);
  assertEq(c6, null, '1100Z on 14th is before validity');

  // Exactly at FM boundary — should be in the new FM group
  const c7 = conditionsAt(taf, 18, 14);
  assertEq(c7.base.type, 'FM', '1800Z base is FM');
  assertEq(c7.base.meta.windSpeedKt, 15, '1800Z wind 15kt (new FM)');

  // At 0000Z on the 15th — exactly on the last FM boundary
  const c8 = conditionsAt(taf, 0, 15);
  assertEq(c8.base.type, 'FM', '0000Z base is FM (last)');
  assertEq(c8.base.meta.windSpeedKt, 8, '0000Z wind 8kt');

  console.log('  Standard TAF temporal queries done.\n');
}

// ============================================================================
// Section 3: conditionsDuring — flight window queries
// ============================================================================

console.log('Section 3: Flight window queries (conditionsDuring)\n');

{
  const taf = parseTAF(
    'TAF KXNA 141130Z 1412/1512 18008KT P6SM SKC ' +
    'FM141800 21015G25KT 3SM TSRA BKN020CB ' +
    'FM150000 27008KT P6SM SCT040'
  );

  // Flight window entirely in initial period
  const w1 = conditionsDuring(taf, 14, 14, 14, 17);
  assert(w1.length >= 1, 'window 1400-1700 should have at least 1 period');
  assert(w1.some(r => r.period.type === 'INITIAL'), 'window includes INITIAL');
  assert(!w1.some(r => r.period.type === 'FM' && r.period.meta.hasThunderstorm),
    'window 1400-1700 should not include the storm FM');

  // Flight window spanning FM boundary
  const w2 = conditionsDuring(taf, 14, 16, 14, 20);
  assert(w2.length >= 2, 'window 1600-2000 should span 2+ periods');
  assert(w2.some(r => r.period.type === 'INITIAL'), 'window includes INITIAL');
  assert(w2.some(r => r.period.type === 'FM' && r.period.meta.hasThunderstorm),
    'window includes storm FM');

  // Flight window entirely in last FM
  const w3 = conditionsDuring(taf, 15, 2, 15, 6);
  assert(w3.length >= 1, 'window 0200-0600 should have at least 1 period');
  const w3base = w3.find(r => r.period.type === 'FM');
  assert(w3base && w3base.meta.windSpeedKt === 8, 'window 0200-0600 wind 8kt');

  console.log('  Flight window queries done.\n');
}

// ============================================================================
// Section 4: Full-spectrum fuzzer with independent re-derivation
//
// Three verification layers, following the methodology of regress_examgen.js
// and browser-cloud-fuzz.js:
//
//   A. Independent parser — a from-scratch implementation here that shares NO
//      code with taf_parser.js. Both must agree on every field for every period.
//      "Two independent implementations agreeing across thousands of random
//      cases is a much stronger statement than either one passing its own
//      unit tests." — browser-cloud-fuzz.js
//
//   B. Generator truth — every period's decoded fields must match what
//      taf_gen.js put in (not just the initial period).
//
//   C. Domain invariants — sky layers must ascend, summation basis must hold,
//      gust > sustained, no negative durations, no gaps in FM coverage.
// ============================================================================

console.log('Section 4: Full-spectrum fuzzer with independent re-derivation\n');

const { generateTAF: genTAF } = require('./taf_gen');

const FUZZ_COUNT = +(process.argv[2] || 1000);
let fuzzFails = 0;

function fuzzAssert(cond, f, msg, tafStr) {
  if (!cond) {
    console.log(`  FUZZ FAIL #${f}: ${msg}`);
    if (tafStr) console.log(`    TAF: ${tafStr}`);
    fuzzFails++;
    return false;
  }
  return true;
}

// ---- Independent TAF period-body parser ------------------------------------
// Deliberately shares NO code with taf_parser.js. If both parsers share a bug,
// the agreement is meaningless; two separate implementations catching the same
// answer is the strongest statement we can make without a human reading every
// generated TAF.

const INDEP_WX_DESC = new Set(['MI','PR','BC','DR','BL','SH','TS','FZ']);
const INDEP_WX_PHEN = new Set(['DZ','RA','SN','SG','IC','PL','GR','GS','UP','PY',
  'BR','FG','FU','VA','DU','SA','HZ','PO','SQ','FC','DS','SS']);
const INDEP_PRECIP = new Set(['DZ','RA','SN','SG','IC','PL','GR','GS','UP']);
const INDEP_OBSCUR = new Set(['FG','BR','HZ','FU','DU','SA','VA']);

function indepIsWx(tok) {
  let s = tok;
  if (s[0] === '+' || s[0] === '-') s = s.slice(1);
  if (s.startsWith('VC')) s = s.slice(2);
  if (s.length < 2) return false;
  while (s.length >= 2) {
    const pair = s.slice(0, 2);
    if (!INDEP_WX_DESC.has(pair) && !INDEP_WX_PHEN.has(pair)) return false;
    s = s.slice(2);
  }
  return s.length === 0;
}

function indepParseBody(tokens) {
  const out = {
    windDir: null, windSpeedKt: null, windGustKt: null,
    visibilityMiles: null, visibilityOp: '',
    hasThunderstorm: false, hasPrecip: false, hasObscuration: false, hasNSW: false,
    layers: [], ceilingFt: null, lowestLayerFt: null, lowestLayerCov: null,
  };
  let i = 0;

  // Wind
  if (tokens[i] && /^(\d{3}|VRB|000)\d{2,3}(G\d{2,3})?KT$/.test(tokens[i])) {
    const wm = tokens[i].match(/^(\d{3}|VRB|000)(\d{2,3})(?:G(\d{2,3}))?KT$/);
    out.windDir = wm[1] === 'VRB' ? 'VRB' : parseInt(wm[1], 10);
    out.windSpeedKt = parseInt(wm[2], 10);
    out.windGustKt = wm[3] ? parseInt(wm[3], 10) : null;
    i++;
    if (tokens[i] && /^\d{3}V\d{3}$/.test(tokens[i])) i++;
  }

  // Visibility
  if (tokens[i]) {
    if (/^\d{1,2}$/.test(tokens[i]) && tokens[i + 1] && /^\d\/\d{1,2}SM$/.test(tokens[i + 1])) {
      const whole = parseInt(tokens[i], 10);
      const fp = tokens[i + 1].replace('SM', '').split('/');
      out.visibilityMiles = whole + parseInt(fp[0], 10) / parseInt(fp[1], 10);
      i += 2;
    } else if (/^P\d/.test(tokens[i]) && tokens[i].endsWith('SM')) {
      out.visibilityMiles = parseInt(tokens[i].slice(1), 10);
      out.visibilityOp = 'greater than';
      i++;
    } else if (/^M?\d/.test(tokens[i]) && tokens[i].endsWith('SM')) {
      const raw = tokens[i].replace('SM', '');
      if (raw[0] === 'M') {
        out.visibilityOp = 'less than';
        const inner = raw.slice(1);
        out.visibilityMiles = inner.includes('/') ?
          parseInt(inner.split('/')[0], 10) / parseInt(inner.split('/')[1], 10) :
          parseInt(inner, 10);
      } else if (raw.includes('/')) {
        out.visibilityMiles = parseInt(raw.split('/')[0], 10) / parseInt(raw.split('/')[1], 10);
      } else {
        out.visibilityMiles = parseInt(raw, 10);
      }
      i++;
    }
  }

  // NSW
  if (tokens[i] === 'NSW') { out.hasNSW = true; i++; }

  // Weather
  while (tokens[i] && indepIsWx(tokens[i])) {
    const wx = tokens[i];
    let s = wx;
    if (s[0] === '+' || s[0] === '-') s = s.slice(1);
    if (s.startsWith('VC')) s = s.slice(2);
    while (s.length >= 2) {
      const pair = s.slice(0, 2);
      if (pair === 'TS') out.hasThunderstorm = true;
      if (INDEP_PRECIP.has(pair)) out.hasPrecip = true;
      if (INDEP_OBSCUR.has(pair)) out.hasObscuration = true;
      s = s.slice(2);
    }
    i++;
  }

  // Sky
  while (tokens[i] && /^(SKC|CLR|NSC|NCD|FEW|SCT|BKN|OVC|VV)(\d{3})?(CB|TCU)?$/.test(tokens[i])) {
    const sm = tokens[i].match(/^(SKC|CLR|NSC|NCD|FEW|SCT|BKN|OVC|VV)(\d{3})?(CB|TCU)?$/);
    const cov = sm[1];
    const feet = sm[2] ? parseInt(sm[2], 10) * 100 : null;
    out.layers.push({ cov, feet, raw: tokens[i] });
    if (feet !== null) {
      if ((cov === 'BKN' || cov === 'OVC' || cov === 'VV') &&
          (out.ceilingFt === null || feet < out.ceilingFt))
        out.ceilingFt = feet;
      if (out.lowestLayerFt === null || feet < out.lowestLayerFt) {
        out.lowestLayerFt = feet;
        out.lowestLayerCov = cov;
      }
    }
    i++;
  }

  return out;
}

// Extract just the weather-body tokens from a period's raw string,
// stripping the change-group marker prefix
function bodyTokensOf(period) {
  const raw = period.raw;
  if (period.type === 'INITIAL') return raw.split(/\s+/).filter(Boolean);

  // FM DDHHmm body...
  if (period.type === 'FM') {
    const parts = raw.split(/\s+/);
    return parts.slice(1); // skip the FMDDHHmm token
  }

  // BECMG/TEMPO/PROB: marker tokens then DDHH/DDHH then body
  // The period.raw starts with the full marker string. Count how many
  // tokens the marker consumed and skip them.
  const parts = raw.split(/\s+/);
  let skip = 0;
  if (/^FM/.test(parts[0])) skip = 1;
  else if (/^PROB/.test(parts[0]) && parts[1] === 'TEMPO') skip = 3;
  else if (/^PROB/.test(parts[0])) skip = 2;
  else if (parts[0] === 'BECMG' || parts[0] === 'TEMPO') skip = 2;
  return parts.slice(skip);
}

// ---- Domain invariant checks per period ------------------------------------
const COV_RANK = { FEW: 1, SCT: 2, BKN: 3, OVC: 4, VV: 4 };

function checkInvariants(meta, f, pi, ptype, tafStr) {
  const tag = `period[${pi}](${ptype})`;

  // Gust must exceed sustained speed
  if (meta.windGustKt !== null && meta.windSpeedKt !== null) {
    fuzzAssert(meta.windGustKt > meta.windSpeedKt, f,
      `${tag}: gust ${meta.windGustKt} <= sustained ${meta.windSpeedKt}`, tafStr);
  }

  // Sky layers must ascend in height
  const layersWithFt = meta.layers.filter(l => l.feet !== null);
  for (let k = 1; k < layersWithFt.length; k++) {
    fuzzAssert(layersWithFt[k].feet > layersWithFt[k - 1].feet, f,
      `${tag}: sky layers do not ascend (${layersWithFt[k - 1].raw} then ${layersWithFt[k].raw})`, tafStr);
  }

  // Summation basis: sky coverage cannot decrease with height
  for (let k = 1; k < layersWithFt.length; k++) {
    const prevRank = COV_RANK[layersWithFt[k - 1].cov];
    const currRank = COV_RANK[layersWithFt[k].cov];
    if (prevRank !== undefined && currRank !== undefined) {
      fuzzAssert(currRank >= prevRank, f,
        `${tag}: sky cover decreases with height (${layersWithFt[k - 1].raw} then ${layersWithFt[k].raw}) — violates summation convention`, tafStr);
    }
  }

  // No layer above VV (vertical visibility = indefinite ceiling)
  // Multiple OVC layers at different heights are legal (summation convention)
  const vvIdx = layersWithFt.findIndex(l => l.cov === 'VV');
  if (vvIdx !== -1) {
    fuzzAssert(vvIdx === layersWithFt.length - 1, f,
      `${tag}: layer reported above VV`, tafStr);
  }

  // Ceiling must be the lowest BKN/OVC/VV
  const ceilLayers = layersWithFt.filter(l => ['BKN', 'OVC', 'VV'].includes(l.cov));
  const expectedCeiling = ceilLayers.length ? Math.min(...ceilLayers.map(l => l.feet)) : null;
  fuzzAssert(meta.ceilingFt === expectedCeiling, f,
    `${tag}: ceiling ${meta.ceilingFt} != expected ${expectedCeiling}`, tafStr);

  // Lowest layer must be the lowest of all layers
  const expectedLowest = layersWithFt.length ? Math.min(...layersWithFt.map(l => l.feet)) : null;
  fuzzAssert(meta.lowestLayerFt === expectedLowest, f,
    `${tag}: lowestLayerFt ${meta.lowestLayerFt} != expected ${expectedLowest}`, tafStr);
}

// ---- Main fuzz loop --------------------------------------------------------

for (let f = 0; f < FUZZ_COUNT; f++) {
  const { tafString: tafStr, truth } = genTAF();
  const taf = parseTAF(tafStr);

  if (!fuzzAssert(!taf.error, f, `parse error: ${taf.error}`, tafStr)) continue;

  // Header checks
  fuzzAssert(taf.station === truth.station, f,
    `station: expected ${truth.station}, got ${taf.station}`, tafStr);
  fuzzAssert(taf.amendment === truth.amendment, f,
    `amendment: expected ${truth.amendment}, got ${taf.amendment}`, tafStr);
  fuzzAssert(taf.validity.startDay === truth.validity.startDay &&
    taf.validity.startHour === truth.validity.startHour &&
    taf.validity.endDay === truth.validity.endDay &&
    taf.validity.endHour === truth.validity.endHour, f,
    `validity mismatch`, tafStr);

  fuzzAssert(taf.periods.length >= truth.fmCount + 1, f,
    `period count: expected >= ${truth.fmCount + 1}, got ${taf.periods.length}`, tafStr);
  fuzzAssert(taf.periods[0].type === 'INITIAL', f,
    `first period: expected INITIAL, got ${taf.periods[0].type}`, tafStr);

  // ---- Layer A: structural checks on FM/INITIAL periods --------------------
  const fmPeriods = taf.periods.filter(p => p.type === 'INITIAL' || p.type === 'FM');
  const refDay = truth.validity.startDay;

  for (const p of fmPeriods) {
    fuzzAssert(p.endDay !== null && p.endHour !== null, f,
      `${p.type} period missing end time`, tafStr);
  }
  for (let j = 1; j < fmPeriods.length; j++) {
    const prev = toMinutes(fmPeriods[j - 1].startDay, fmPeriods[j - 1].startHour,
      fmPeriods[j - 1].startMin || 0, refDay);
    const curr = toMinutes(fmPeriods[j].startDay, fmPeriods[j].startHour,
      fmPeriods[j].startMin || 0, refDay);
    fuzzAssert(curr > prev, f, `FM periods out of order at index ${j}`, tafStr);
  }
  for (let j = 0; j < fmPeriods.length - 1; j++) {
    if (fmPeriods[j].endDay === null) continue;
    const thisEnd = toMinutes(fmPeriods[j].endDay, fmPeriods[j].endHour,
      fmPeriods[j].endMin || 0, refDay);
    const nextStart = toMinutes(fmPeriods[j + 1].startDay, fmPeriods[j + 1].startHour,
      fmPeriods[j + 1].startMin || 0, refDay);
    fuzzAssert(thisEnd === nextStart, f,
      `gap between FM[${j}] end (${thisEnd}min) and FM[${j + 1}] start (${nextStart}min)`, tafStr);
  }
  for (const p of fmPeriods) {
    if (p.endDay === null) continue;
    const pStart = toMinutes(p.startDay, p.startHour, p.startMin || 0, refDay);
    const pEnd = toMinutes(p.endDay, p.endHour, p.endMin || 0, refDay);
    fuzzAssert(pEnd > pStart, f,
      `negative or zero duration for ${p.type} (start=${pStart}, end=${pEnd})`, tafStr);
  }

  // Overlay structural checks
  const overlays = taf.periods.filter(p =>
    p.type === 'BECMG' || p.type === 'TEMPO' || p.type === 'PROB');
  for (const ov of overlays) {
    fuzzAssert(ov.endDay !== null && ov.endHour !== null, f,
      `${ov.type} overlay missing end time`, tafStr);
    if (ov.endDay !== null) {
      const ovStart = toMinutes(ov.startDay, ov.startHour, 0, refDay);
      const ovEnd = toMinutes(ov.endDay, ov.endHour, 0, refDay);
      fuzzAssert(ovEnd > ovStart, f,
        `${ov.type} overlay non-positive duration`, tafStr);
    }
    if (ov.prob) fuzzAssert(ov.prob === 30 || ov.prob === 40, f,
      `bad prob value: ${ov.prob}`, tafStr);
  }

  // ---- Layer B: independent re-derivation of every period ------------------
  // Parse each period's body with the independent parser and compare against
  // taf_parser's meta. This is the TAF equivalent of regress_examgen's
  // independent METAR parser.
  for (let pi = 0; pi < taf.periods.length; pi++) {
    const p = taf.periods[pi];
    const tag = `period[${pi}](${p.type})`;
    fuzzAssert(p.meta != null, f, `${tag} missing meta`, tafStr);
    if (!p.meta) continue;

    const bodyToks = bodyTokensOf(p);
    const indep = indepParseBody(bodyToks);

    // Wind
    fuzzAssert(p.meta.windSpeedKt === indep.windSpeedKt, f,
      `${tag} windSpeedKt: parser=${p.meta.windSpeedKt} vs indep=${indep.windSpeedKt}`, tafStr);
    fuzzAssert(p.meta.windGustKt === indep.windGustKt, f,
      `${tag} windGustKt: parser=${p.meta.windGustKt} vs indep=${indep.windGustKt}`, tafStr);

    // Visibility
    if (indep.visibilityMiles !== null) {
      fuzzAssert(Math.abs((p.meta.visibilityMiles || 0) - indep.visibilityMiles) < 0.01, f,
        `${tag} visMiles: parser=${p.meta.visibilityMiles} vs indep=${indep.visibilityMiles}`, tafStr);
    }

    // Weather flags
    fuzzAssert(p.meta.hasThunderstorm === indep.hasThunderstorm, f,
      `${tag} hasThunderstorm: parser=${p.meta.hasThunderstorm} vs indep=${indep.hasThunderstorm}`, tafStr);
    fuzzAssert(p.meta.hasPrecip === indep.hasPrecip, f,
      `${tag} hasPrecip: parser=${p.meta.hasPrecip} vs indep=${indep.hasPrecip}`, tafStr);
    fuzzAssert(p.meta.hasObscuration === indep.hasObscuration, f,
      `${tag} hasObscuration: parser=${p.meta.hasObscuration} vs indep=${indep.hasObscuration}`, tafStr);
    fuzzAssert(p.meta.hasNSW === indep.hasNSW, f,
      `${tag} hasNSW: parser=${p.meta.hasNSW} vs indep=${indep.hasNSW}`, tafStr);

    // Ceiling and lowest layer
    fuzzAssert(p.meta.ceilingFt === indep.ceilingFt, f,
      `${tag} ceilingFt: parser=${p.meta.ceilingFt} vs indep=${indep.ceilingFt}`, tafStr);
    fuzzAssert(p.meta.lowestLayerFt === indep.lowestLayerFt, f,
      `${tag} lowestLayerFt: parser=${p.meta.lowestLayerFt} vs indep=${indep.lowestLayerFt}`, tafStr);

    // Layer count
    fuzzAssert(p.meta.layers.length === indep.layers.length, f,
      `${tag} layer count: parser=${p.meta.layers.length} vs indep=${indep.layers.length}`, tafStr);
  }

  // ---- Layer B2: truth-check every period against generator -----------------
  // Match parser periods to truth periods by type and position
  const truthByType = {};
  truth.periods.forEach(tp => {
    const key = tp.type;
    if (!truthByType[key]) truthByType[key] = [];
    truthByType[key].push(tp);
  });
  const parsedByType = {};
  taf.periods.forEach(pp => {
    const key = pp.type;
    if (!parsedByType[key]) parsedByType[key] = [];
    parsedByType[key].push(pp);
  });

  for (const type of Object.keys(truthByType)) {
    const truthList = truthByType[type];
    const parsedList = parsedByType[type] || [];
    const count = Math.min(truthList.length, parsedList.length);
    for (let k = 0; k < count; k++) {
      const tm = truthList[k].meta;
      const pm = parsedList[k].meta;
      const tag = `${type}[${k}]`;

      fuzzAssert(pm.windSpeedKt === tm.windSpeedKt, f,
        `${tag} truth windSpeedKt: parser=${pm.windSpeedKt} vs truth=${tm.windSpeedKt}`, tafStr);
      fuzzAssert(pm.windGustKt === tm.windGustKt, f,
        `${tag} truth windGustKt: parser=${pm.windGustKt} vs truth=${tm.windGustKt}`, tafStr);
      fuzzAssert(Math.abs((pm.visibilityMiles || 0) - tm.visibilityMiles) < 0.1, f,
        `${tag} truth visMiles: parser=${pm.visibilityMiles} vs truth=${tm.visibilityMiles}`, tafStr);
      fuzzAssert(pm.hasThunderstorm === tm.hasThunderstorm, f,
        `${tag} truth hasThunderstorm: parser=${pm.hasThunderstorm} vs truth=${tm.hasThunderstorm}`, tafStr);
      fuzzAssert(pm.hasPrecip === tm.hasPrecip, f,
        `${tag} truth hasPrecip: parser=${pm.hasPrecip} vs truth=${tm.hasPrecip}`, tafStr);
      fuzzAssert(pm.hasObscuration === tm.hasObscuration, f,
        `${tag} truth hasObscuration: parser=${pm.hasObscuration} vs truth=${tm.hasObscuration}`, tafStr);
    }
  }

  // ---- Layer C: domain invariants on every period --------------------------
  for (let pi = 0; pi < taf.periods.length; pi++) {
    if (!taf.periods[pi].meta) continue;
    checkInvariants(taf.periods[pi].meta, f, pi, taf.periods[pi].type, tafStr);
  }

  // ---- conditionsAt / conditionsDuring coverage ----------------------------
  const valStart = toMinutes(truth.validity.startDay, truth.validity.startHour, 0, refDay);
  const valEnd = toMinutes(truth.validity.endDay, truth.validity.endHour, 0, refDay);
  const totalHours = Math.floor((valEnd - valStart) / 60);
  let condFail = false;
  for (let h = 0; h < totalHours && !condFail; h++) {
    let qDay = truth.validity.startDay;
    let qHour = truth.validity.startHour + h;
    while (qHour >= 24) { qHour -= 24; qDay++; }
    if (qDay > 31) qDay -= 31;

    const c = conditionsAt(taf, qHour, qDay);
    if (!fuzzAssert(c !== null, f,
      `conditionsAt null at ${qDay}/${qHour}Z`, tafStr)) { condFail = true; break; }
    if (!fuzzAssert(c.base !== null, f,
      `conditionsAt no base at ${qDay}/${qHour}Z`, tafStr)) { condFail = true; break; }
  }

  const dur = conditionsDuring(taf, truth.validity.startDay, truth.validity.startHour,
    truth.validity.endDay, truth.validity.endHour);
  fuzzAssert(dur.length >= 1, f,
    `conditionsDuring over full validity returned ${dur.length} periods`, tafStr);
}

fails += fuzzFails;
console.log(`  ${FUZZ_COUNT} random TAFs verified across 3 layers:`);
console.log(`    A. Independent re-derivation (body parser shares no code with taf_parser.js)`);
console.log(`    B. Generator truth matching (every period, not just initial)`);
console.log(`    C. Domain invariants (summation basis, layer order, gust > sustained, ceiling/lowest)`);
console.log(`  Result: ${fuzzFails === 0 ? 'all passed' : fuzzFails + ' FAILURE(S)'}.\n`);

// ============================================================================
// Section 5: Error-case tests
// ============================================================================

console.log('Section 5: Error cases\n');

{
  const t1 = parseTAF('METAR KXNA 141453Z 18004KT 10SM CLR 24/13 A3002');
  assert(t1.error !== null, 'METAR fed as TAF should error');
  assertEq(t1.error, 'Missing TAF identifier', 'error message for non-TAF');

  const t2 = parseTAF('TAF 141130Z 1412/1512 18008KT P6SM SKC');
  assert(t2.error !== null, 'Missing station should error');

  const t3 = parseTAF('TAF KXNA 1412/1512 18008KT P6SM SKC');
  assert(t3.error !== null, 'Missing issue time should error');

  const t4 = parseTAF('TAF KXNA 141130Z 18008KT P6SM SKC');
  assert(t4.error !== null, 'Missing validity should error');

  console.log('  Error cases done.\n');
}

// ============================================================================
// Summary
// ============================================================================

console.log('========================================');
console.log(`${passes} passed, ${fails} failed.`);
if (fails) {
  console.log(`\n${fails} FAILURE(S)`);
} else {
  console.log('\nAll TAF regression tests passed.');
}
process.exit(fails ? 1 : 0);
