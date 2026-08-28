// Random TAF generator — produces syntactically valid TAFs with all group types
// (FM, BECMG, TEMPO, PROB) and realistic weather tokens. Used by the regression
// fuzzer and as the foundation for browser-taf-fuzz.js.
//
// Usage:
//   const { generateTAF, generateTAFString } = require('./taf_gen');
//   const { tafString, truth } = generateTAF();
//   // truth contains the structured fields that were used to build the string,
//   // so a test can verify the parser reproduces them exactly.

'use strict';

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pick(arr) { return arr[randInt(0, arr.length - 1)]; }
function maybe(p) { return Math.random() < p; }

// ── Building blocks ─────────────────────────────────────────────────────────

const STATIONS = [
  'KXNA', 'KJFK', 'KLAX', 'KORD', 'KATL', 'KDEN', 'KSFO', 'KBOS',
  'KMIA', 'KIAD', 'KDFW', 'KIAH', 'KPHX', 'KSEA', 'KLAS', 'KMCO',
  'KBNA', 'KMSN', 'KMSP', 'KCLE'
];

function randomStation() {
  if (maybe(0.3)) return pick(STATIONS);
  return 'K' + String.fromCharCode(65 + randInt(0, 25)) +
    String.fromCharCode(65 + randInt(0, 25)) +
    String.fromCharCode(65 + randInt(0, 25));
}

function randomWind() {
  if (maybe(0.05)) return { str: '00000KT', dir: 0, speed: 0, gust: null };
  const vrb = maybe(0.08);
  const dir = vrb ? 'VRB' : String(randInt(1, 36) * 10).padStart(3, '0');
  const speed = randInt(3, 35);
  const hasGust = maybe(0.35) && speed >= 8;
  const gust = hasGust ? randInt(speed + 5, Math.min(speed + 25, 65)) : null;
  const str = dir + String(speed).padStart(2, '0') +
    (gust ? 'G' + String(gust).padStart(2, '0') : '') + 'KT';
  return { str, dir: vrb ? 'VRB' : parseInt(dir, 10), speed, gust };
}

const VIS_OPTIONS = [
  { str: '1/4SM',   miles: 0.25, op: '' },
  { str: '1/2SM',   miles: 0.5,  op: '' },
  { str: '3/4SM',   miles: 0.75, op: '' },
  { str: '1SM',     miles: 1,    op: '' },
  { str: '1 1/2SM', miles: 1.5,  op: '' },
  { str: '2SM',     miles: 2,    op: '' },
  { str: '3SM',     miles: 3,    op: '' },
  { str: '4SM',     miles: 4,    op: '' },
  { str: '5SM',     miles: 5,    op: '' },
  { str: '6SM',     miles: 6,    op: '' },
  { str: 'P6SM',    miles: 6,    op: 'greater than' },
];

function randomVis() { return pick(VIS_OPTIONS); }

const SKY_COVERS = ['FEW', 'SCT', 'BKN', 'OVC'];

function randomSkyGroup() {
  if (maybe(0.1)) {
    const c = pick(['SKC', 'CLR']);
    return { str: c, layers: [{ cov: c, feet: null, type: null, raw: c }],
      ceiling: null, lowestFt: null, lowestCov: null };
  }
  if (maybe(0.03)) {
    const ft = randInt(0, 10) * 100;
    const raw = 'VV' + String(ft / 100).padStart(3, '0');
    return { str: raw, layers: [{ cov: 'VV', feet: ft, type: null, raw }],
      ceiling: ft, lowestFt: ft, lowestCov: 'VV' };
  }
  const count = randInt(1, 3);
  const layers = [];
  let minFt = randInt(5, 100) * 100;
  let prevCovIdx = 0;
  let ceiling = null;
  let lowestFt = null;
  let lowestCov = null;
  for (let i = 0; i < count; i++) {
    const covIdx = randInt(Math.max(prevCovIdx, i === 0 ? 0 : prevCovIdx), 3);
    const cov = SKY_COVERS[covIdx];
    const ft = minFt + randInt(0, 20) * 100;
    const hasCB = maybe(0.08) && (cov === 'BKN' || cov === 'SCT');
    const hasTCU = !hasCB && maybe(0.05) && (cov === 'SCT' || cov === 'FEW');
    const type = hasCB ? 'CB' : (hasTCU ? 'TCU' : null);
    const raw = cov + String(ft / 100).padStart(3, '0') + (type || '');
    layers.push({ cov, feet: ft, type, raw });
    if ((cov === 'BKN' || cov === 'OVC') && (ceiling === null || ft < ceiling))
      ceiling = ft;
    if (lowestFt === null || ft < lowestFt) { lowestFt = ft; lowestCov = cov; }
    minFt = ft + randInt(5, 30) * 100;
    prevCovIdx = covIdx;
  }
  return { str: layers.map(l => l.raw).join(' '), layers, ceiling, lowestFt, lowestCov };
}

const WX_GROUPS = [
  { str: 'RA',     precip: true,  obscur: false, ts: false },
  { str: '-RA',    precip: true,  obscur: false, ts: false },
  { str: '+RA',    precip: true,  obscur: false, ts: false },
  { str: 'SN',     precip: true,  obscur: false, ts: false },
  { str: '-SN',    precip: true,  obscur: false, ts: false },
  { str: '+SN',    precip: true,  obscur: false, ts: false },
  { str: 'DZ',     precip: true,  obscur: false, ts: false },
  { str: '-DZ',    precip: true,  obscur: false, ts: false },
  { str: 'FZRA',   precip: true,  obscur: false, ts: false },
  { str: 'FZDZ',   precip: true,  obscur: false, ts: false },
  { str: 'PL',     precip: true,  obscur: false, ts: false },
  { str: 'GR',     precip: true,  obscur: false, ts: false },
  { str: 'GS',     precip: true,  obscur: false, ts: false },
  { str: 'SNRA',   precip: true,  obscur: false, ts: false },
  { str: 'RASN',   precip: true,  obscur: false, ts: false },
  { str: 'SHRA',   precip: true,  obscur: false, ts: false },
  { str: '-SHRA',  precip: true,  obscur: false, ts: false },
  { str: 'SHSN',   precip: true,  obscur: false, ts: false },
  { str: 'TSRA',   precip: true,  obscur: false, ts: true  },
  { str: '+TSRA',  precip: true,  obscur: false, ts: true  },
  { str: '-TSRA',  precip: true,  obscur: false, ts: true  },
  { str: 'TSSN',   precip: true,  obscur: false, ts: true  },
  { str: 'TS',     precip: false, obscur: false, ts: true  },
  { str: 'BR',     precip: false, obscur: true,  ts: false },
  { str: 'FG',     precip: false, obscur: true,  ts: false },
  { str: 'HZ',     precip: false, obscur: true,  ts: false },
  { str: 'FU',     precip: false, obscur: true,  ts: false },
  { str: '-SNBR',  precip: true,  obscur: true,  ts: false },
  { str: 'BLSN',   precip: true,  obscur: false, ts: false },
  { str: 'BLDU',   precip: false, obscur: true,  ts: false },
  { str: 'BLSA',   precip: false, obscur: true,  ts: false },
  { str: 'DRSN',   precip: true,  obscur: false, ts: false },
];

function randomWx() {
  if (maybe(0.55)) return null;
  const wx = pick(WX_GROUPS);
  return wx;
}

// ── Period body builder ─────────────────────────────────────────────────────

function buildPeriodBody(opts) {
  opts = opts || {};
  const wind = opts.wind || randomWind();
  const vis = opts.vis || randomVis();
  const wx = opts.wx !== undefined ? opts.wx : randomWx();
  const nsw = opts.nsw || false;
  const sky = opts.sky || randomSkyGroup();

  const parts = [wind.str, vis.str];
  if (nsw) parts.push('NSW');
  if (wx) parts.push(wx.str);
  parts.push(sky.str);

  const truth = {
    windDir: wind.dir,
    windSpeedKt: wind.speed,
    windGustKt: wind.gust,
    visibilityMiles: vis.miles,
    visibilityOp: vis.op,
    hasThunderstorm: wx ? wx.ts : false,
    hasPrecip: wx ? wx.precip : false,
    hasObscuration: wx ? wx.obscur : false,
    hasNSW: nsw,
    ceilingFt: sky.ceiling,
    lowestLayerFt: sky.lowestFt,
    lowestLayerCov: sky.lowestCov,
    layers: sky.layers,
    wxStr: wx ? wx.str : null,
  };

  return { str: parts.join(' '), truth };
}

// ── Time arithmetic ─────────────────────────────────────────────────────────

function addHours(day, hour, delta) {
  let h = hour + delta;
  let d = day;
  while (h >= 24) { h -= 24; d++; }
  while (h < 0) { h += 24; d--; }
  if (d > 31) d -= 31;
  if (d < 1) d += 31;
  return { day: d, hour: h };
}

function toMinutes(day, hour, min, refDay) {
  let dayOffset = day - refDay;
  if (dayOffset < 0) dayOffset += 31;
  return dayOffset * 1440 + hour * 60 + (min || 0);
}

function pad2(n) { return String(n).padStart(2, '0'); }

// ── TAF generator ───────────────────────────────────────────────────────────

function generateTAF(opts) {
  opts = opts || {};

  const station = opts.station || randomStation();
  const amendment = opts.amendment || (maybe(0.08) ? 'AMD' : maybe(0.03) ? 'COR' : null);

  // Validity period
  const startDay = opts.startDay || randInt(1, 28);
  const startHour = opts.startHour !== undefined ? opts.startHour : pick([0, 6, 12, 18]);
  const duration = opts.duration || pick([24, 24, 24, 30]);
  const { day: endDay, hour: endHour } = addHours(startDay, startHour, duration);

  // Issue time: typically ~30min before validity start
  const { day: issueDay, hour: issueHour } = addHours(startDay, startHour, -1);
  const issueMin = 30;

  const validity = {
    startDay, startHour, endDay, endHour,
    raw: pad2(startDay) + pad2(startHour) + '/' + pad2(endDay) + pad2(endHour)
  };

  // Initial conditions body
  const initial = buildPeriodBody(opts.initialBody);

  // Generate change groups
  const periods = [{
    type: 'INITIAL',
    startDay, startHour, startMin: 0,
    endDay: null, endHour: null,
    prob: null,
    body: initial,
  }];

  // FM groups: 0–4, spaced randomly across the validity
  const fmCount = opts.fmCount !== undefined ? opts.fmCount : randInt(0, 4);
  let cursor = addHours(startDay, startHour, randInt(3, 8));

  for (let f = 0; f < fmCount; f++) {
    const fmMin = toMinutes(cursor.day, cursor.hour, 0, startDay);
    const endMin = toMinutes(endDay, endHour, 0, startDay);
    if (fmMin >= endMin - 120) break;

    const fmMinute = maybe(0.7) ? 0 : randInt(0, 5) * 10;
    const body = buildPeriodBody(maybe(0.15) ? { nsw: true } : undefined);

    periods.push({
      type: 'FM',
      startDay: cursor.day, startHour: cursor.hour, startMin: fmMinute,
      endDay: null, endHour: null,
      prob: null,
      body,
    });

    cursor = addHours(cursor.day, cursor.hour, randInt(3, 8));
  }

  // Fill in FM/INITIAL end times
  const fmPeriods = periods.filter(p => p.type === 'INITIAL' || p.type === 'FM');
  for (let f = 0; f < fmPeriods.length; f++) {
    if (f + 1 < fmPeriods.length) {
      fmPeriods[f].endDay = fmPeriods[f + 1].startDay;
      fmPeriods[f].endHour = fmPeriods[f + 1].startHour;
    } else {
      fmPeriods[f].endDay = endDay;
      fmPeriods[f].endHour = endHour;
    }
  }

  // Overlay groups: BECMG, TEMPO, PROB — 0–3 total
  const overlayCount = opts.overlayCount !== undefined ? opts.overlayCount :
    randInt(0, 3);

  for (let o = 0; o < overlayCount; o++) {
    const overlayType = pick(['BECMG', 'TEMPO', 'TEMPO', 'TEMPO', 'PROB']);
    const hasProb = overlayType === 'PROB' || (overlayType === 'TEMPO' && maybe(0.3));
    const prob = hasProb ? pick([30, 40]) : null;
    const actualType = overlayType === 'PROB' ? 'PROB' :
      (overlayType === 'TEMPO' ? 'TEMPO' : 'BECMG');

    // Pick a time window within the validity
    const offsetStart = randInt(2, Math.max(3, duration - 6));
    const windowLen = actualType === 'BECMG' ? randInt(2, 4) : randInt(2, 6);
    const { day: oStartDay, hour: oStartHour } = addHours(startDay, startHour, offsetStart);
    const { day: oEndDay, hour: oEndHour } = addHours(startDay, startHour,
      Math.min(offsetStart + windowLen, duration));

    // Overlay body: typically partial (might only have vis + wx, or wind + sky)
    const body = buildPeriodBody();

    periods.push({
      type: actualType === 'PROB' && !hasProb ? 'PROB' : actualType,
      startDay: oStartDay, startHour: oStartHour, startMin: 0,
      endDay: oEndDay, endHour: oEndHour,
      prob,
      body,
    });
  }

  // Build the TAF string
  const headerParts = ['TAF'];
  if (amendment) headerParts.push(amendment);
  headerParts.push(station);
  headerParts.push(pad2(issueDay) + pad2(issueHour) + pad2(issueMin) + 'Z');
  headerParts.push(validity.raw);

  // Initial body
  headerParts.push(initial.str);

  // FM groups (in chronological order) and overlays interleaved
  // Separate FM periods from overlays and sort FM by start time
  const fmOnly = periods.filter(p => p.type === 'FM')
    .sort((a, b) => toMinutes(a.startDay, a.startHour, a.startMin, startDay) -
      toMinutes(b.startDay, b.startHour, b.startMin, startDay));
  const overlays = periods.filter(p => p.type !== 'INITIAL' && p.type !== 'FM')
    .sort((a, b) => toMinutes(a.startDay, a.startHour, 0, startDay) -
      toMinutes(b.startDay, b.startHour, 0, startDay));

  // Merge into string order: for each FM group, emit any overlays that start
  // before the next FM group
  let fmIdx = 0;
  let ovIdx = 0;
  const bodyParts = [];

  while (fmIdx < fmOnly.length || ovIdx < overlays.length) {
    if (fmIdx < fmOnly.length) {
      const fm = fmOnly[fmIdx];
      const fmTime = pad2(fm.startDay) + pad2(fm.startHour) + pad2(fm.startMin);
      bodyParts.push('FM' + fmTime + ' ' + fm.body.str);
      fmIdx++;

      // Emit overlays that start before the next FM (or before validity end)
      const nextFmStart = fmIdx < fmOnly.length ?
        toMinutes(fmOnly[fmIdx].startDay, fmOnly[fmIdx].startHour,
          fmOnly[fmIdx].startMin, startDay) :
        toMinutes(endDay, endHour, 0, startDay);

      while (ovIdx < overlays.length) {
        const ovStart = toMinutes(overlays[ovIdx].startDay,
          overlays[ovIdx].startHour, 0, startDay);
        if (ovStart >= nextFmStart) break;
        bodyParts.push(formatOverlay(overlays[ovIdx]));
        ovIdx++;
      }
    } else {
      bodyParts.push(formatOverlay(overlays[ovIdx]));
      ovIdx++;
    }
  }

  const tafString = headerParts.join(' ') +
    (bodyParts.length ? ' ' + bodyParts.join(' ') : '');

  // Build truth structure for verification
  const truth = {
    station,
    amendment,
    issued: { day: issueDay, hour: issueHour, min: issueMin },
    validity: { startDay, startHour, endDay, endHour },
    periods: buildTruthPeriods(periods, { startDay, startHour, endDay, endHour }),
    fmCount: fmOnly.length,
    overlayCount: overlays.length,
  };

  return { tafString, truth };
}

function formatOverlay(ov) {
  const timeWindow = pad2(ov.startDay) + pad2(ov.startHour) + '/' +
    pad2(ov.endDay) + pad2(ov.endHour);

  if (ov.type === 'BECMG') return 'BECMG ' + timeWindow + ' ' + ov.body.str;
  if (ov.type === 'TEMPO' && ov.prob)
    return 'PROB' + ov.prob + ' TEMPO ' + timeWindow + ' ' + ov.body.str;
  if (ov.type === 'TEMPO') return 'TEMPO ' + timeWindow + ' ' + ov.body.str;
  if (ov.type === 'PROB')
    return 'PROB' + ov.prob + ' ' + timeWindow + ' ' + ov.body.str;
  return '';
}

function buildTruthPeriods(periods, validity) {
  return periods.map(p => ({
    type: p.type,
    startDay: p.startDay,
    startHour: p.startHour,
    startMin: p.startMin || 0,
    endDay: p.endDay,
    endHour: p.endHour,
    prob: p.prob,
    meta: p.body.truth,
  }));
}

// ── Generate just the string (convenience) ──────────────────────────────────

function generateTAFString(opts) {
  return generateTAF(opts).tafString;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { generateTAF, generateTAFString, randomWind, randomVis,
    randomSkyGroup, randomWx, buildPeriodBody, addHours, toMinutes };
}
