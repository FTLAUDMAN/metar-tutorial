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
// Section 4: Cross-midnight arithmetic fuzzer
// ============================================================================

console.log('Section 4: Cross-midnight arithmetic fuzzer\n');

const FUZZ_COUNT = +(process.argv[2] || 1000);
let fuzzFails = 0;

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

const SKY_COVERS = ['FEW', 'SCT', 'BKN', 'OVC'];
const SKY_ORDER = { FEW: 0, SCT: 1, BKN: 2, OVC: 3 };

function randomSkyGroup() {
  const count = randInt(1, 3);
  const layers = [];
  let minFt = randInt(5, 100) * 100;
  let prevCov = 0;
  for (let i = 0; i < count; i++) {
    const covIdx = randInt(prevCov, 3);
    const cov = SKY_COVERS[covIdx];
    const ft = minFt + randInt(0, 20) * 100;
    layers.push(cov + String(ft / 100).padStart(3, '0'));
    minFt = ft + randInt(5, 30) * 100;
    prevCov = covIdx;
  }
  return layers.join(' ');
}

function randomWind() {
  const dir = String(randInt(1, 36) * 10).padStart(3, '0');
  const speed = String(randInt(3, 30)).padStart(2, '0');
  const gust = Math.random() > 0.5 ? 'G' + String(randInt(parseInt(speed) + 5, 50)).padStart(2, '0') : '';
  return dir + speed + gust + 'KT';
}

function randomVis() {
  const vis = [
    '1/4SM', '1/2SM', '3/4SM', '1SM', '1 1/2SM', '2SM', '3SM', '4SM', '5SM', '6SM', 'P6SM'
  ];
  return vis[randInt(0, vis.length - 1)];
}

for (let f = 0; f < FUZZ_COUNT; f++) {
  // Generate a random TAF with cross-midnight potential
  const startDay = randInt(1, 30);
  const startHour = randInt(0, 23);
  const durationHours = randInt(18, 30);
  const endHour = (startHour + durationHours) % 24;
  const endDay = startDay + Math.floor((startHour + durationHours) / 24);
  const actualEndDay = endDay > 31 ? endDay - 31 : endDay;

  const issueDay = startDay;
  const issueHour = startHour > 0 ? startHour - 1 : 23;
  const issueMin = 30;

  const station = 'K' + String.fromCharCode(65 + randInt(0, 25)) +
    String.fromCharCode(65 + randInt(0, 25)) + String.fromCharCode(65 + randInt(0, 25));

  const validity = String(startDay).padStart(2, '0') + String(startHour).padStart(2, '0') + '/' +
    String(actualEndDay).padStart(2, '0') + String(endHour).padStart(2, '0');
  const issued = String(issueDay).padStart(2, '0') + String(issueHour).padStart(2, '0') +
    String(issueMin).padStart(2, '0') + 'Z';

  // Build 1-3 FM groups at random hours within validity
  const fmCount = randInt(0, 3);
  const fmHours = [];
  let currentDay = startDay;
  let currentHour = startHour + randInt(3, 8);
  for (let g = 0; g < fmCount; g++) {
    if (currentHour >= 24) {
      currentDay += Math.floor(currentHour / 24);
      currentHour = currentHour % 24;
    }
    if (currentDay > 31) currentDay -= 31;

    // Check we haven't gone past the end
    const fmMin = toMinutes(currentDay, currentHour, 0, startDay);
    const endMin = toMinutes(actualEndDay, endHour, 0, startDay);
    if (fmMin >= endMin - 60) break;

    fmHours.push({ day: currentDay, hour: currentHour });
    currentHour += randInt(3, 8);
  }

  let tafStr = `TAF ${station} ${issued} ${validity} ${randomWind()} ${randomVis()} ${randomSkyGroup()}`;
  for (const fm of fmHours) {
    const fmTime = String(fm.day).padStart(2, '0') + String(fm.hour).padStart(2, '0') + '00';
    tafStr += ` FM${fmTime} ${randomWind()} ${randomVis()} ${randomSkyGroup()}`;
  }

  const taf = parseTAF(tafStr);

  // Assertions
  if (taf.error) {
    console.log(`  FUZZ FAIL #${f}: parse error on: ${tafStr}`);
    console.log(`    error: ${taf.error}`);
    fuzzFails++;
    continue;
  }

  // Every FM/INITIAL period must have an end time
  const fmPeriods = taf.periods.filter(p => p.type === 'INITIAL' || p.type === 'FM');
  for (const p of fmPeriods) {
    if (p.endDay === null || p.endHour === null) {
      console.log(`  FUZZ FAIL #${f}: ${p.type} period missing end time`);
      fuzzFails++;
    }
  }

  // Periods must be in chronological order (FM/INITIAL only)
  for (let j = 1; j < fmPeriods.length; j++) {
    const prevStart = toMinutes(fmPeriods[j - 1].startDay, fmPeriods[j - 1].startHour,
      fmPeriods[j - 1].startMin || 0, startDay);
    const currStart = toMinutes(fmPeriods[j].startDay, fmPeriods[j].startHour,
      fmPeriods[j].startMin || 0, startDay);
    if (currStart <= prevStart) {
      console.log(`  FUZZ FAIL #${f}: FM periods out of order at index ${j}`);
      console.log(`    TAF: ${tafStr}`);
      fuzzFails++;
    }
  }

  // No gaps: each FM period's end must equal the next FM period's start
  for (let j = 0; j < fmPeriods.length - 1; j++) {
    const thisEnd = toMinutes(fmPeriods[j].endDay, fmPeriods[j].endHour, 0, startDay);
    const nextStart = toMinutes(fmPeriods[j + 1].startDay, fmPeriods[j + 1].startHour,
      fmPeriods[j + 1].startMin || 0, startDay);
    if (thisEnd !== nextStart) {
      console.log(`  FUZZ FAIL #${f}: gap between FM[${j}] end and FM[${j + 1}] start`);
      console.log(`    end=${thisEnd}min, nextStart=${nextStart}min`);
      console.log(`    TAF: ${tafStr}`);
      fuzzFails++;
    }
  }

  // No negative-duration periods
  for (const p of fmPeriods) {
    const pStart = toMinutes(p.startDay, p.startHour, p.startMin || 0, startDay);
    const pEnd = toMinutes(p.endDay, p.endHour, 0, startDay);
    if (pEnd <= pStart) {
      console.log(`  FUZZ FAIL #${f}: negative or zero duration for ${p.type}`);
      console.log(`    start=${pStart}min, end=${pEnd}min`);
      console.log(`    TAF: ${tafStr}`);
      fuzzFails++;
    }
  }

  // conditionsAt must return a result for every hour in the validity
  let checkDay = startDay;
  let checkHour = startHour;
  const totalHours = durationHours;
  for (let h = 0; h < totalHours; h++) {
    let qDay = checkDay + Math.floor((checkHour + h) / 24);
    let qHour = (checkHour + h) % 24;
    if (qDay > 31) qDay -= 31;

    const c = conditionsAt(taf, qHour, qDay);
    if (!c) {
      console.log(`  FUZZ FAIL #${f}: conditionsAt returned null for ${qDay}/${qHour}Z`);
      console.log(`    validity: ${validity}`);
      console.log(`    TAF: ${tafStr}`);
      fuzzFails++;
      break;
    }
    if (!c.base) {
      console.log(`  FUZZ FAIL #${f}: conditionsAt returned no base for ${qDay}/${qHour}Z`);
      fuzzFails++;
      break;
    }
  }
}

fails += fuzzFails;
console.log(`  ${FUZZ_COUNT} random TAFs generated and checked.`);
console.log(`  Cross-midnight fuzz: ${fuzzFails === 0 ? 'all passed' : fuzzFails + ' FAILURE(S)'}.\n`);

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
