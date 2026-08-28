// TAF parser — standalone module that can be required by test harnesses or
// pasted into the tutorial HTML later. Reuses the same weather-token and
// sky-token encoding as parseMETAR, with its own implementations of those
// decoders (no dependency on the METAR page).
//
// Usage:
//   const { parseTAF, conditionsAt } = require('./taf_parser');
//   const taf = parseTAF('TAF KXNA 141130Z 1412/1512 18008KT P6SM SKC ...');
//   const active = conditionsAt(taf, 18, 14);  // 1800Z on the 14th

'use strict';

const WX_DESCRIPTORS = ['MI','PR','BC','DR','BL','SH','TS','FZ'];
const WX_PHENOMENA = ['DZ','RA','SN','SG','IC','PL','GR','GS','UP','PY',
  'BR','FG','FU','VA','DU','SA','HZ','PO','SQ','FC','DS','SS'];

function matchWeatherToken(tok) {
  let s = tok;
  let intensity = '';
  if (s[0] === '+' || s[0] === '-') { intensity = s[0]; s = s.slice(1); }
  let vicinity = false;
  if (s.startsWith('VC')) { vicinity = true; s = s.slice(2); }
  const descriptors = [];
  while (s.length >= 2 && WX_DESCRIPTORS.includes(s.slice(0, 2))) {
    descriptors.push(s.slice(0, 2)); s = s.slice(2);
  }
  const phenomena = [];
  while (s.length >= 2 && WX_PHENOMENA.includes(s.slice(0, 2))) {
    phenomena.push(s.slice(0, 2)); s = s.slice(2);
  }
  if (s.length > 0) return null;
  if (descriptors.length === 0 && phenomena.length === 0) return null;
  return { intensity, vicinity, descriptors, phenomena, raw: tok };
}

function decodeSkyToken(tok) {
  const m = tok.match(/^(SKC|CLR|NSC|NCD|FEW|SCT|BKN|OVC|VV)(\d{3})?(CB|TCU)?$/);
  if (!m) return null;
  const [, cov, hgt, type] = m;
  const feet = hgt ? parseInt(hgt, 10) * 100 : null;
  return { cov, feet, type: type || null, raw: tok };
}

function decodeVisibility(rawVis) {
  let s = rawVis.replace('SM', '');
  let op = '';
  if (s[0] === 'M') { op = 'less than'; s = s.slice(1); }
  if (s[0] === 'P') { op = 'greater than'; s = s.slice(1); }
  let miles = null;
  if (s.includes(' ')) {
    const [whole, frac] = s.split(' ');
    const [n, d] = frac.split('/').map(Number);
    miles = parseInt(whole, 10) + n / d;
  } else if (s.includes('/')) {
    const [n, d] = s.split('/').map(Number);
    miles = n / d;
  } else {
    miles = parseInt(s, 10);
  }
  return { miles, op, raw: rawVis };
}

function decodeWind(tok) {
  const m = tok.match(/^(\d{3}|VRB|000)(\d{2,3})(G(\d{2,3}))?KT$/);
  if (!m) return null;
  const dir = m[1] === 'VRB' ? 'VRB' : parseInt(m[1], 10);
  const speed = parseInt(m[2], 10);
  const gust = m[4] ? parseInt(m[4], 10) : null;
  return { dir, speed, gust, raw: tok };
}

// Parse a DDHH validity time pair like "1412/1512"
function parseValidity(tok) {
  const m = tok.match(/^(\d{2})(\d{2})\/(\d{2})(\d{2})$/);
  if (!m) return null;
  return {
    startDay: parseInt(m[1], 10),
    startHour: parseInt(m[2], 10),
    endDay: parseInt(m[3], 10),
    endHour: parseInt(m[4], 10),
    raw: tok
  };
}

// Parse the weather body tokens within a single TAF period (everything after
// the group marker and time, up to the next group marker or end). Returns a
// meta object compatible with parseMETAR's meta shape.
function parsePeriodBody(tokens) {
  const meta = {
    windDir: null, windSpeedKt: null, windGustKt: null,
    visibilityMiles: null, visibilityOp: '',
    wxCodes: [], wxRaw: [],
    layers: [],
    ceilingFt: null,
    lowestLayerFt: null, lowestLayerCov: null,
    hasThunderstorm: false, tsVicinity: false, tsOverhead: false,
    hasObscuration: false, hasPrecip: false,
    tempMax: null, tempMin: null,
    hasNSW: false
  };

  let i = 0;

  // Wind
  if (tokens[i] && /^(\d{3}|VRB|000)\d{2,3}(G\d{2,3})?KT$/.test(tokens[i])) {
    const w = decodeWind(tokens[i]);
    meta.windDir = w.dir;
    meta.windSpeedKt = w.speed;
    meta.windGustKt = w.gust;
    i++;
    // Variable wind direction group
    if (tokens[i] && /^\d{3}V\d{3}$/.test(tokens[i])) i++;
  }

  // Visibility (US statute miles format)
  if (tokens[i]) {
    if (/^\d{1,2}$/.test(tokens[i]) && tokens[i + 1] && /^\d{1,2}\/\d{1,2}SM$/.test(tokens[i + 1])) {
      const combined = tokens[i] + ' ' + tokens[i + 1];
      const dec = decodeVisibility(combined);
      meta.visibilityMiles = dec.miles;
      meta.visibilityOp = dec.op;
      i += 2;
    } else if (/^(M|P)?\d{1,2}(\/\d{1,2})?SM$/.test(tokens[i])) {
      const dec = decodeVisibility(tokens[i]);
      meta.visibilityMiles = dec.miles;
      meta.visibilityOp = dec.op;
      i++;
    } else if (/^\d{4}(NDV|[NSEW]{1,2})?$/.test(tokens[i])) {
      // ICAO metric visibility
      const mm = tokens[i].match(/^(\d{4})(NDV|[NSEW]{1,2})?$/);
      const meters = parseInt(mm[1], 10);
      const unlimited = meters >= 9999;
      meta.visibilityMiles = unlimited ? 6.21 : Math.round((meters / 1609.344) * 100) / 100;
      meta.visibilityOp = unlimited ? 'greater than' : '';
      i++;
    }
  }

  // NSW — no significant weather (explicitly cancels previous weather)
  if (tokens[i] === 'NSW') {
    meta.hasNSW = true;
    i++;
  }

  // Weather phenomena
  while (tokens[i] && matchWeatherToken(tokens[i])) {
    const w = matchWeatherToken(tokens[i]);
    meta.wxCodes.push(w);
    meta.wxRaw.push(tokens[i]);
    if (w.descriptors.includes('TS')) {
      meta.hasThunderstorm = true;
      if (w.vicinity) meta.tsVicinity = true; else meta.tsOverhead = true;
    }
    if (w.phenomena.some(p => ['FG', 'BR', 'HZ', 'FU', 'DU', 'SA', 'VA'].includes(p)))
      meta.hasObscuration = true;
    if (w.phenomena.some(p => ['DZ', 'RA', 'SN', 'SG', 'IC', 'PL', 'GR', 'GS', 'UP'].includes(p)))
      meta.hasPrecip = true;
    i++;
  }

  // Sky condition
  while (tokens[i] && /^(SKC|CLR|NSC|NCD|FEW|SCT|BKN|OVC|VV)(\d{3})?(CB|TCU)?$/.test(tokens[i])) {
    const d = decodeSkyToken(tokens[i]);
    meta.layers.push(d);
    if (d.feet !== null) {
      if ((d.cov === 'BKN' || d.cov === 'OVC' || d.cov === 'VV') &&
          (meta.ceilingFt === null || d.feet < meta.ceilingFt))
        meta.ceilingFt = d.feet;
      if (meta.lowestLayerFt === null || d.feet < meta.lowestLayerFt) {
        meta.lowestLayerFt = d.feet;
        meta.lowestLayerCov = d.cov;
      }
    }
    i++;
  }

  // TX/TN temperature groups (optional in TAFs)
  while (tokens[i] && /^T[XN]M?\d{2}\/\d{2,4}Z$/.test(tokens[i])) {
    const tm = tokens[i].match(/^T([XN])(M?)(\d{2})\/(\d{2,4})Z$/);
    const temp = (tm[2] === 'M' ? -1 : 1) * parseInt(tm[3], 10);
    if (tm[1] === 'X') meta.tempMax = temp;
    else meta.tempMin = temp;
    i++;
  }

  return { meta, consumed: i };
}

// Parse a change-group time marker. Returns null if the token doesn't start a
// change group.
function parseChangeGroup(tokens, i, validity) {
  const tok = tokens[i];

  // FM DDHHmm — "from" group, abrupt change
  if (tok && /^FM\d{6}$/.test(tok)) {
    const m = tok.match(/^FM(\d{2})(\d{2})(\d{2})$/);
    return {
      type: 'FM',
      startDay: parseInt(m[1], 10),
      startHour: parseInt(m[2], 10),
      startMin: parseInt(m[3], 10),
      endDay: null,   // filled in later from the next group or validity end
      endHour: null,
      prob: null,
      raw: tok,
      consumed: 1
    };
  }

  // PROB30 or PROB40, possibly followed by TEMPO
  if (tok && /^PROB(30|40)$/.test(tok)) {
    const prob = parseInt(tok.match(/^PROB(\d{2})$/)[1], 10);
    // PROB can qualify a TEMPO group or stand alone with a time window
    if (tokens[i + 1] === 'TEMPO' && tokens[i + 2] && /^\d{4}\/\d{4}$/.test(tokens[i + 2])) {
      const v = parseValidity(tokens[i + 2]);
      return {
        type: 'TEMPO',
        startDay: v.startDay,
        startHour: v.startHour,
        startMin: 0,
        endDay: v.endDay,
        endHour: v.endHour,
        prob,
        raw: tok + ' ' + tokens[i + 1] + ' ' + tokens[i + 2],
        consumed: 3
      };
    }
    // PROB alone with a time window
    if (tokens[i + 1] && /^\d{4}\/\d{4}$/.test(tokens[i + 1])) {
      const v = parseValidity(tokens[i + 1]);
      return {
        type: 'PROB',
        startDay: v.startDay,
        startHour: v.startHour,
        startMin: 0,
        endDay: v.endDay,
        endHour: v.endHour,
        prob,
        raw: tok + ' ' + tokens[i + 1],
        consumed: 2
      };
    }
    return null;
  }

  // BECMG DDHH/DDHH
  if (tok === 'BECMG' && tokens[i + 1] && /^\d{4}\/\d{4}$/.test(tokens[i + 1])) {
    const v = parseValidity(tokens[i + 1]);
    return {
      type: 'BECMG',
      startDay: v.startDay,
      startHour: v.startHour,
      startMin: 0,
      endDay: v.endDay,
      endHour: v.endHour,
      prob: null,
      raw: tok + ' ' + tokens[i + 1],
      consumed: 2
    };
  }

  // TEMPO DDHH/DDHH
  if (tok === 'TEMPO' && tokens[i + 1] && /^\d{4}\/\d{4}$/.test(tokens[i + 1])) {
    const v = parseValidity(tokens[i + 1]);
    return {
      type: 'TEMPO',
      startDay: v.startDay,
      startHour: v.startHour,
      startMin: 0,
      endDay: v.endDay,
      endHour: v.endHour,
      prob: null,
      raw: tok + ' ' + tokens[i + 1],
      consumed: 2
    };
  }

  return null;
}

// Convert a day/hour pair into a minutes-from-reference value for ordering.
// The reference is the TAF validity start. Handles cross-midnight correctly:
// if a time appears to be before the validity start, it's in the next month
// cycle (day wrapped).
function toMinutes(day, hour, min, refDay) {
  let dayOffset = day - refDay;
  // Handle month wraparound: if the day is much smaller than refDay,
  // it wrapped to the next month (e.g., validity 30th–1st).
  // A TAF spans at most 30 hours (~1.25 days), so any negative offset
  // means the day wrapped into the next month.
  if (dayOffset < 0) dayOffset += 31;
  return dayOffset * 1440 + hour * 60 + (min || 0);
}

function parseTAF(rawInput) {
  const raw = rawInput.trim().toUpperCase().replace(/\s+/g, ' ');
  const tokens = raw.length ? raw.split(' ') : [];
  let i = 0;

  const result = {
    raw,
    type: null,       // 'TAF'
    amendment: null,   // 'AMD', 'COR', or null
    station: null,
    issued: null,      // { day, hour, min }
    validity: null,    // { startDay, startHour, endDay, endHour }
    periods: [],       // array of period objects
    error: null
  };

  // TAF header
  if (tokens[i] === 'TAF') {
    result.type = 'TAF';
    i++;
  } else {
    result.error = 'Missing TAF identifier';
    return result;
  }

  // AMD or COR qualifier
  if (tokens[i] && /^(AMD|COR)$/.test(tokens[i])) {
    result.amendment = tokens[i];
    i++;
  }

  // Station identifier
  if (tokens[i] && /^[A-Z0-9]{4}$/.test(tokens[i])) {
    result.station = tokens[i];
    i++;
  } else {
    result.error = 'Missing or invalid station identifier';
    return result;
  }

  // Issue time DDHHmmZ
  if (tokens[i] && /^\d{6}Z$/.test(tokens[i])) {
    const t = tokens[i];
    result.issued = {
      day: parseInt(t.slice(0, 2), 10),
      hour: parseInt(t.slice(2, 4), 10),
      min: parseInt(t.slice(4, 6), 10)
    };
    i++;
  } else {
    result.error = 'Missing or invalid issue time';
    return result;
  }

  // Validity period DDHH/DDHH
  if (tokens[i] && /^\d{4}\/\d{4}$/.test(tokens[i])) {
    result.validity = parseValidity(tokens[i]);
    i++;
  } else {
    result.error = 'Missing or invalid validity period';
    return result;
  }

  // Collect all body tokens (everything after the header)
  const bodyTokens = tokens.slice(i);

  // Find every change-group marker position and its parsed descriptor
  const markers = []; // {index, cg}
  for (let j = 0; j < bodyTokens.length; j++) {
    const cg = parseChangeGroup(bodyTokens, j, result.validity);
    if (cg) {
      markers.push({ index: j, cg });
      j += cg.consumed - 1; // skip consumed tokens
    }
  }

  const periods = [];

  // Initial conditions: everything from start to the first marker
  const initialEnd = markers.length > 0 ? markers[0].index : bodyTokens.length;
  const initialToks = bodyTokens.slice(0, initialEnd);
  const { meta: initialMeta } = parsePeriodBody(initialToks);
  periods.push({
    type: 'INITIAL',
    startDay: result.validity.startDay,
    startHour: result.validity.startHour,
    startMin: 0,
    endDay: null,
    endHour: null,
    endMin: 0,
    prob: null,
    meta: initialMeta,
    raw: initialToks.join(' ')
  });

  // Each change group: body tokens run from after its marker tokens to the
  // next marker (or end of body)
  for (let k = 0; k < markers.length; k++) {
    const mk = markers[k];
    const bodyStart = mk.index + mk.cg.consumed;
    const bodyEnd = k + 1 < markers.length ? markers[k + 1].index : bodyTokens.length;
    const bodyToks = bodyTokens.slice(bodyStart, bodyEnd);
    const { meta } = parsePeriodBody(bodyToks);
    periods.push({
      type: mk.cg.type,
      startDay: mk.cg.startDay,
      startHour: mk.cg.startHour,
      startMin: mk.cg.startMin || 0,
      endDay: mk.cg.endDay,
      endHour: mk.cg.endHour,
      endMin: 0,
      prob: mk.cg.prob,
      meta,
      raw: mk.cg.raw + (bodyToks.length ? ' ' + bodyToks.join(' ') : '')
    });
  }

  // Fill in end times for FM and INITIAL periods (they end when the next FM
  // starts, or at the TAF validity end). FM groups can start at non-zero
  // minutes (FM141820 = 18:20), so endMin must capture that.
  const fmPeriods = periods.filter(p => p.type === 'INITIAL' || p.type === 'FM');
  for (let f = 0; f < fmPeriods.length; f++) {
    if (fmPeriods[f].endDay === null) {
      if (f + 1 < fmPeriods.length) {
        fmPeriods[f].endDay = fmPeriods[f + 1].startDay;
        fmPeriods[f].endHour = fmPeriods[f + 1].startHour;
        fmPeriods[f].endMin = fmPeriods[f + 1].startMin || 0;
      } else {
        fmPeriods[f].endDay = result.validity.endDay;
        fmPeriods[f].endHour = result.validity.endHour;
        fmPeriods[f].endMin = 0;
      }
    }
  }

  result.periods = periods;
  return result;
}

// Given a parsed TAF and a Zulu time (hour, day), return the effective
// conditions. FM groups establish baselines; BECMG/TEMPO overlay or modify
// the active FM group's conditions.
//
// Returns: { base, overlays[] } where base is the FM/INITIAL period active at
// that time, and overlays are any BECMG/TEMPO/PROB periods whose windows
// include the query time.
function conditionsAt(taf, hour, day, min) {
  if (!taf || !taf.validity || taf.error) return null;
  min = min || 0;

  const refDay = taf.validity.startDay;
  const queryMin = toMinutes(day, hour, min, refDay);
  const valStart = toMinutes(taf.validity.startDay, taf.validity.startHour, 0, refDay);
  const valEnd = toMinutes(taf.validity.endDay, taf.validity.endHour, 0, refDay);

  if (queryMin < valStart || queryMin >= valEnd) return null;

  // Find the active FM/INITIAL period
  const fmPeriods = taf.periods.filter(p => p.type === 'INITIAL' || p.type === 'FM');
  let base = null;
  for (let f = fmPeriods.length - 1; f >= 0; f--) {
    const pStart = toMinutes(fmPeriods[f].startDay, fmPeriods[f].startHour,
      fmPeriods[f].startMin || 0, refDay);
    if (queryMin >= pStart) {
      base = fmPeriods[f];
      break;
    }
  }

  // Collect active overlays (BECMG, TEMPO, PROB)
  const overlays = [];
  for (const p of taf.periods) {
    if (p.type === 'BECMG' || p.type === 'TEMPO' || p.type === 'PROB') {
      const pStart = toMinutes(p.startDay, p.startHour, p.startMin || 0, refDay);
      const pEnd = toMinutes(p.endDay, p.endHour, 0, refDay);
      if (queryMin >= pStart && queryMin < pEnd) {
        overlays.push(p);
      }
    }
  }

  return { base, overlays };
}

// Enumerate all distinct condition sets across a time window.
// Returns an array of { period, meta } for every FM/INITIAL period that
// overlaps [startHour on startDay, endHour on endDay), plus any
// BECMG/TEMPO/PROB overlays that fall within the window.
function conditionsDuring(taf, startDay, startHour, endDay, endHour) {
  if (!taf || !taf.validity || taf.error) return [];

  const refDay = taf.validity.startDay;
  const winStart = toMinutes(startDay, startHour, 0, refDay);
  const winEnd = toMinutes(endDay, endHour, 0, refDay);

  const results = [];
  for (const p of taf.periods) {
    const pStart = toMinutes(p.startDay, p.startHour, p.startMin || 0, refDay);
    let pEnd;
    if (p.endDay !== null && p.endHour !== null) {
      pEnd = toMinutes(p.endDay, p.endHour, p.endMin || 0, refDay);
    } else {
      // Use validity end as fallback
      pEnd = toMinutes(taf.validity.endDay, taf.validity.endHour, 0, refDay);
    }

    // Check overlap
    if (pStart < winEnd && pEnd > winStart) {
      results.push({ period: p, meta: p.meta });
    }
  }

  return results;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseTAF, conditionsAt, conditionsDuring, toMinutes,
    matchWeatherToken, decodeSkyToken, decodeVisibility, decodeWind,
    parseValidity, parsePeriodBody };
}
