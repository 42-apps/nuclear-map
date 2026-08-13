/* ============================================================================
   Global Nuclear Weapons Map — globe + site markers + arsenal timeline.
   Data: data/nuclear-data.js (countries), data/sites.js, data/history.js
         (series, events, tests, treaties, human cost), data/cities.js
   Engine: globe.gl (bundled). Forked from the 42-apps globe family.
   ========================================================================== */
'use strict';

/* ------------------------------- data ------------------------------- */
const C        = window.NUKE_COUNTRIES || {};
const SITES    = (window.NUKE_SITES || []).slice();
const SERIES   = window.NUKE_SERIES || {};
const GLOBALS  = window.NUKE_GLOBAL || [];
const EVENTS   = (window.NUKE_EVENTS || []).slice().sort((a, b) => a.y - b.y);
const WTYPES   = window.NUKE_WARHEAD_TYPES || [];
const TESTS    = window.NUKE_TESTS || [];
const TESTC    = window.NUKE_TESTCOUNTS || [];
const TREATIES = window.NUKE_TREATIES || [];
const HUMAN    = window.NUKE_HUMAN || {};
const ISOMAP   = window.NUKE_ISO || {};
const ALIASES  = window.NUKE_ALIASES || {};
const CITIES   = window.NUKE_CITIES || [];
const META     = window.NUKE_META || {};
const RESEARCH = window.NUKE_RESEARCH || { gaps: [], findings: [] };

const SITE_BY_ID = {}; SITES.forEach(s => (SITE_BY_ID[s.id] = s));
const EV_BY_ID = {}; EVENTS.forEach(e => (EV_BY_ID[e.id] = e));

const Y0 = 1938, Y1 = META.year || 2026;
const NEUTRAL = 'rgba(96,116,134,0.13)';
const NODATA  = 'rgba(70,86,100,0.10)';

/* ---------------------------- status vocab ---------------------------- */
const STATUS = {
  declared:   { label: 'Declared arsenal',        color: '#2fd66f', glyph: '☢', rank: 1,
                desc: 'Openly acknowledges nuclear weapons. All five are recognised nuclear-weapon states under the NPT.' },
  undeclared: { label: 'Undeclared arsenal',      color: '#ffc93c', glyph: '☢', rank: 2,
                desc: 'Possesses nuclear weapons in the assessment of essentially every independent analyst, but has never confirmed it.' },
  outside:    { label: 'Declared, outside the NPT', color: '#7ee787', glyph: '☢', rank: 3,
                desc: 'Openly nuclear-armed, but never joined the NPT (or withdrew from it).' },
  pursuing:   { label: 'Pursuing / threshold',    color: '#ff4d4d', glyph: '⚠', rank: 4,
                desc: 'Widely assessed to be seeking a nuclear weapon, or to be close enough to build one quickly.' },
  host:       { label: "Hosts another state's weapons", color: '#4da3ff', glyph: '🛡', rank: 5,
                desc: 'No weapons of its own, but foreign nuclear weapons are stationed on its territory.' },
  exhost:     { label: 'Hosted foreign weapons in the past', color: '#3d6f9e', glyph: '◌', rank: 6,
                desc: 'Foreign nuclear weapons were once stationed here and have since been withdrawn.' },
  former:     { label: 'Built weapons, gave them up', color: '#b57cff', glyph: '✔', rank: 7,
                desc: 'Had assembled nuclear weapons and then dismantled or surrendered every one of them.' },
  program:    { label: 'Abandoned weapons programme', color: '#8f6fd0', glyph: '✔', rank: 8,
                desc: 'Ran a nuclear-weapons programme and stopped before completing a weapon.' },
  latent:     { label: 'Latent / hedging',        color: '#6fd2c8', glyph: '○', rank: 9,
                desc: 'Has the industrial and technical means to build a weapon quickly, and an active domestic debate about doing so.' },
  none:       { label: 'No nuclear weapons',      color: '#5a6b7a', glyph: '·', rank: 10, desc: '' },
};
const st = k => STATUS[k] || STATUS.none;

const CONF = {
  confirmed: { label: 'Confirmed',  color: '#2fd66f' },
  high:      { label: 'High confidence', color: '#7ee787' },
  medium:    { label: 'Medium confidence', color: '#ffc93c' },
  low:       { label: 'Low confidence', color: '#ff8c1a' },
  suspected: { label: 'Suspected',  color: '#ff4d4d' },
};

/* Site categories — group the many raw `type` values into user-facing buckets. */
const SITE_CATS = {
  deploy:  { label: 'Deployed weapons', color: '#ff4d4d', shape: 'dot',  on: true,
             types: ['silo_field', 'missile_field', 'mobile_missile_base', 'sub_base', 'air_base', 'bomber_base', 'deployment_hosted'] },
  store:   { label: 'Storage & depots', color: '#ff8c1a', shape: 'sq',   on: true,
             types: ['storage', 'depot', 'command_bunker'] },
  make:    { label: 'Making the bomb',  color: '#ffd23f', shape: 'dia',  on: true,
             types: ['production', 'enrichment', 'reprocessing', 'reactor', 'assembly', 'warhead_lab', 'research', 'mine', 'proposed'] },
  test:    { label: 'Test sites',       color: '#c07cff', shape: 'tri',  on: true,  types: ['test_site'] },
  gone:    { label: 'Former & dismantled', color: '#7a8b99', shape: 'ring', on: false,
             types: ['former', 'dismantled', 'destroyed'] },
};
const CAT_ORDER = ['deploy', 'store', 'make', 'test', 'gone'];
const TYPE_TO_CAT = {};
CAT_ORDER.forEach(k => SITE_CATS[k].types.forEach(t => (TYPE_TO_CAT[t] = k)));
function catOf(s) {
  if (s.status === 'former' || s.status === 'dismantled' || s.status === 'destroyed') return 'gone';
  return TYPE_TO_CAT[s.type] || 'store';
}

const EVENT_CATS = {
  test:      { label: 'Tests',        color: '#ff8c1a' },
  use:       { label: 'Use in war',   color: '#ff3b30' },
  program:   { label: 'Programmes',   color: '#ffd23f' },
  crisis:    { label: 'Crises & close calls', color: '#ff4d9e' },
  accident:  { label: 'Accidents',    color: '#ff6b3d' },
  treaty:    { label: 'Treaties',     color: '#4dc9ff' },
  disarm:    { label: 'Disarmament',  color: '#2fd66f' },
  prolif:    { label: 'Proliferation', color: '#c07cff' },
};
const evCat = k => EVENT_CATS[k] || { label: k || 'other', color: '#8c9cab' };

/* ------------------------------ layers ------------------------------ */
const RAMPS = {
  heat:  ['#1b2a38', '#7a4a1e', '#e06a1a', '#ffd23f'],
  fire:  ['#1e2430', '#8a2b1e', '#ff4d2a', '#ffe08a'],
  demo:  ['#ffffff', '#ffd9a0', '#f08a4b', '#c0392b', '#6d1b16'],   // white = most democratic
  cool:  ['#16232f', '#1f5f8b', '#3fa9d8', '#a9e5ff'],
  time:  ['#ffe08a', '#ff8c1a', '#c0392b', '#5a2740'],              // early = bright
};
const LAYERS = {
  status: {
    label: 'Nuclear status', kind: 'cat', field: 'status',
    desc: 'Who has nuclear weapons — and how certain the world is about it.',
    cats: STATUS, order: Object.keys(STATUS).filter(k => k !== 'none'),
    statLabel: 'nuclear-armed states', stat: y => nuclearStatesAt(y),
  },
  warheads: {
    label: 'Number of warheads', kind: 'num', ramp: 'heat', fmt: 'int', scale: 'log',
    desc: 'Total nuclear warheads in the national inventory, including those awaiting dismantlement.',
    val: (iso, y) => seriesAt(iso, y),
    statLabel: 'in military stockpiles', stat: y => globalAt(y).n, statFmt: 'int',
  },
  megatons: {
    label: 'Total explosive power', kind: 'num', ramp: 'fire', fmt: 'mt', unit: ' Mt', scale: 'log',
    desc: 'Combined yield of the whole arsenal, in megatons of TNT. One megaton is about 66 Hiroshimas.',
    val: (iso, y) => mtAt(iso, y),
    statLabel: 'megatons worldwide', stat: y => worldMtAt(y), statFmt: 'mt',
  },
  democracy: {
    label: 'Democracy of the holder', kind: 'num', ramp: 'demo', fmt: 'dec2', invert: true,
    desc: 'How democratic each nuclear-relevant country is (EIU Democracy Index, 0–10). White = most democratic, deep red = authoritarian.',
    val: iso => (C[iso] && C[iso].dem && C[iso].dem.eiu != null ? C[iso].dem.eiu : null),
    domain: [0, 10],
    statLabel: 'average, nuclear-armed states', stat: () => avgDem(), statFmt: 'dec2',
  },
  tests: {
    label: 'Nuclear tests conducted', kind: 'num', ramp: 'cool', fmt: 'int', scale: 'log',
    desc: 'Nuclear explosive tests carried out by each state, 1945 to today.',
    val: (iso, y) => testsBy(iso, y),
    statLabel: 'tests worldwide', stat: y => TESTC.reduce((a, t) => a + testsBy(t.iso3, y), 0), statFmt: 'int',
  },
  firstTest: {
    label: 'When they got the bomb', kind: 'num', ramp: 'time', fmt: 'year', sortAsc: true,
    desc: 'The year each state first tested — or, for Israel, is assessed to have assembled — a nuclear weapon.',
    val: iso => (C[iso] && C[iso].gotYear) || null,
    domain: [1945, 2010],
    statLabel: 'states, in order of arrival', stat: () => Object.keys(C).filter(k => C[k].gotYear).length, statFmt: 'int',
  },
  perCapita: {
    label: 'Warheads per million people', kind: 'num', ramp: 'heat', fmt: 'dec1', scale: 'sqrt',
    desc: 'Warheads relative to population — a very different picture from raw totals.',
    val: (iso, y) => { const n = seriesAt(iso, y), p = C[iso] && C[iso].pop; return n && p ? n / (p / 1e6) : null; },
    statLabel: 'world average per million', stat: y => { const g = globalAt(y).n, p = 8.1e9; return g / (p / 1e6); }, statFmt: 'dec1',
  },
  treaty: {
    label: 'Treaty commitments', kind: 'cat', field: 'nptCat',
    desc: 'How each country sits with the Non-Proliferation Treaty and the Treaty on the Prohibition of Nuclear Weapons.',
    cats: {
      nws:      { label: 'NPT nuclear-weapon state', color: '#2fd66f' },
      nnws:     { label: 'NPT non-nuclear state',    color: '#4da3ff' },
      outside:  { label: 'Never joined the NPT',     color: '#ff8c1a' },
      withdrew: { label: 'Withdrew from the NPT',    color: '#ff4d4d' },
      tpnw:     { label: 'Also banned the bomb (TPNW)', color: '#b57cff' },
    },
    order: ['nws', 'nnws', 'outside', 'withdrew', 'tpnw'],
    statLabel: 'NPT parties worldwide', stat: () => 191, statFmt: 'int',
  },
};
const LAYER_ORDER = ['status', 'warheads', 'megatons', 'democracy', 'tests', 'firstTest', 'perCapita', 'treaty'];

/* ------------------------------- state ------------------------------- */
const state = {
  layer: 'status', year: Y1, hovered: null, selected: null, selectedSite: null,
  selectedEvent: null, playing: false, playDir: 1, flat: false, reach: null,
  zoomAlt: 2.45,
  cats: Object.fromEntries(CAT_ORDER.map(k => [k, SITE_CATS[k].on])),
  evCats: Object.fromEntries(Object.keys(EVENT_CATS).map(k => [k, true])),
};
let playTimer = null, spinOn = true;

/* ------------------------------ helpers ------------------------------ */
const clamp01 = t => Math.max(0, Math.min(1, t));
const isoOf = p => p.ADM0_A3 || p.ISO_A3 || null;
const a2Of = iso => (C[iso] && C[iso].a2) || (ISOMAP[iso] && ISOMAP[iso].a2) || null;
function flagOf(iso) {
  if (ISOMAP[iso] && ISOMAP[iso].flag) return ISOMAP[iso].flag;
  const a2 = a2Of(iso);
  if (!a2 || a2.length !== 2) return '🏳️';
  return String.fromCodePoint(...[...a2.toUpperCase()].map(ch => 0x1f1e6 + ch.charCodeAt(0) - 65));
}
const nameOf = (iso, feat) => (C[iso] && C[iso].n) || (ISOMAP[iso] && ISOMAP[iso].name) ||
  (feat && (feat.properties.ADMIN || feat.properties.NAME)) || iso;

/* "the United States'" not "United States's"; "Turkey's" not "the Turkey's". */
const TAKES_THE = /^(United States|United Kingdom|Netherlands|Philippines|Czech Republic|Russian Federation|Republic of|Democratic)/;
const theName = n => (TAKES_THE.test(n) ? 'the ' + n : n);
const possessive = n => theName(n) + (/s$/i.test(n) ? "'" : "'s");

const nf = new Intl.NumberFormat('en-US');
const fmtInt = n => (n == null ? '—' : nf.format(Math.round(n)));
function fmtMt(n) {
  if (n == null) return '—';
  if (n >= 100) return nf.format(Math.round(n));
  if (n >= 10) return n.toFixed(0);
  if (n >= 1) return n.toFixed(1);
  return n.toFixed(2);
}
function fmtNum(v, fmt) {
  if (v == null) return '—';
  if (fmt === 'year') return String(Math.round(v));
  if (fmt === 'int') return fmtInt(v);
  if (fmt === 'mt') return fmtMt(v);
  if (fmt === 'dec1') return (Math.round(v * 10) / 10).toFixed(1);
  if (fmt === 'dec2') return (Math.round(v * 100) / 100).toFixed(2);
  return '' + v;
}
/* A country holding six of fifty-five thousand warheads is not "0.0%". */
function fmtShare(share) {
  if (share == null) return '—';
  if (share > 0 && share < 0.05) return '&lt;0.1%';
  return share.toFixed(share < 10 ? 1 : 0) + '%';
}
function fmtCompact(n) {
  if (n == null) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
  if (n >= 1e4) return Math.round(n / 1e3) + 'k';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return fmtInt(n);
}
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---- year-aware lookups ---- */
function seriesAt(iso, y) {
  y = y == null ? state.year : y;
  const s = SERIES[iso];
  if (!s || !s.length) {
    /* Degrade gracefully if a country has a headline count but no year series. */
    const c = C[iso];
    if (c && c.wh && c.wh.total != null && y >= (c.armedFrom || c.gotYear || 1945)) return c.wh.total;
    return null;
  }
  if (y < s[0][0]) return null;
  let v = null;
  for (let i = 0; i < s.length; i++) { if (s[i][0] <= y) v = s[i][1]; else break; }
  return v;
}
const GLOBAL_FALLBACK = {};
function globalAt(y) {
  y = y == null ? state.year : y;
  if (GLOBALS.length) {
    let best = { n: 0, states: 0 };
    for (const g of GLOBALS) { if (g[0] <= y) best = { n: g[1], states: g[2] }; else break; }
    return best;
  }
  if (GLOBAL_FALLBACK[y]) return GLOBAL_FALLBACK[y];
  let n = 0, states = 0;
  for (const iso in C) { const v = seriesAt(iso, y); if (v > 0) { n += v; states++; } }
  return (GLOBAL_FALLBACK[y] = { n, states });
}
function nuclearStatesAt(y) {
  y = y == null ? state.year : y;
  const seen = new Set();
  for (const iso in SERIES) if ((seriesAt(iso, y) || 0) > 0) seen.add(iso);
  for (const iso in C) if ((seriesAt(iso, y) || 0) > 0) seen.add(iso);
  return seen.size;
}
/* Megatonnage scaled by how many warheads the country held that year. */
function mtAt(iso, y) {
  const c = C[iso]; if (!c || !c.mt || c.mt.est == null) return null;
  y = y == null ? state.year : y;
  const now = seriesAt(iso, Y1), then = seriesAt(iso, y);
  if (!then) return null;
  if (y === Y1 || !now) return c.mt.est;
  // Historical arsenals were far higher-yield per warhead; use the published
  // world megatonnage curve as a shape function where we have it.
  const f = mtShape(iso, y);
  return f != null ? f : c.mt.est * (then / now);
}
function mtShape(iso, y) {
  const h = (window.NUKE_MEGATON_HISTORY || {})[iso];
  if (!h || !h.length) return null;
  if (y <= h[0][0]) return h[0][1];
  for (let i = 0; i < h.length - 1; i++) {
    if (h[i][0] <= y && y <= h[i + 1][0]) {
      const t = (y - h[i][0]) / (h[i + 1][0] - h[i][0]);
      return h[i][1] + (h[i + 1][1] - h[i][1]) * t;
    }
  }
  return h[h.length - 1][1];
}
function worldMtAt(y) {
  let s = 0, any = false;
  for (const iso in C) { const v = mtAt(iso, y); if (v != null) { s += v; any = true; } }
  return any ? s : null;
}
function testsBy(iso, y) {
  y = y == null ? state.year : y;
  const t = TESTC.find(x => x.iso3 === iso);
  if (!t) return null;
  if (y >= Y1) return t.tests;
  const list = TESTS.filter(x => x.iso3 === iso);
  if (list.length > 20) return list.filter(x => (x.y || parseInt(x.date, 10)) <= y).length;
  const first = t.firstYear || 1945, last = t.lastYear || Y1;
  if (y < first) return 0;
  if (y >= last) return t.tests;
  return Math.round(t.tests * (y - first) / Math.max(1, last - first));
}
function avgDem() {
  const v = Object.keys(C).filter(k => (seriesAt(k, Y1) || 0) > 0 && C[k].dem && C[k].dem.eiu != null).map(k => C[k].dem.eiu);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/* Status of a country in a given year (drives the timeline playback). */
function statusAt(iso, y) {
  const c = C[iso]; if (!c) return null;
  y = y == null ? state.year : y;
  const n = seriesAt(iso, y) || 0;
  if (n > 0) {
    if (c.status === 'undeclared' || c.covert) return 'undeclared';
    if (c.status === 'outside' || c.nptCat === 'outside' || c.nptCat === 'withdrew') return 'outside';
    return 'declared';
  }
  if (c.hostFrom && y >= c.hostFrom && (c.hostTo == null || y <= c.hostTo)) return 'host';
  if (c.armedTo && y > c.armedTo) return 'former';
  if (c.hostTo && y > c.hostTo) return 'exhost';
  if (c.pursuedFrom && y >= c.pursuedFrom && (c.pursuedTo == null || y <= c.pursuedTo)) return 'pursuing';
  if (c.pursuedTo && y > c.pursuedTo) return 'program';
  if (c.status === 'latent') return y >= (c.latentFrom || 1990) ? 'latent' : null;
  return null;
}

/* ------------------------------ colours ------------------------------ */
function rampRGB(arr, t) {
  t = clamp01(t);
  const seg = t * (arr.length - 1), i = Math.min(arr.length - 2, Math.floor(seg)), f = seg - i;
  const a = parseInt(arr[i].slice(1), 16), b = parseInt(arr[i + 1].slice(1), 16);
  return [Math.round((a >> 16 & 255) + ((b >> 16 & 255) - (a >> 16 & 255)) * f),
          Math.round((a >> 8 & 255) + ((b >> 8 & 255) - (a >> 8 & 255)) * f),
          Math.round((a & 255) + ((b & 255) - (a & 255)) * f)];
}
const hexToRgb = h => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };

function layerDomain(key) {
  const L = LAYERS[key];
  if (L.domain) return L.domain;
  const vals = Object.keys(C).map(iso => L.val(iso, state.year)).filter(v => v != null && v > 0);
  if (!vals.length) return [0, 1];
  const max = Math.max(...vals);
  return [0, max];
}
function valOf(iso, key, y) {
  const L = LAYERS[key];
  if (!C[iso]) return null;
  if (L.kind === 'cat') return L.field === 'status' ? statusAt(iso, y) : (C[iso][L.field] || null);
  return L.val(iso, y == null ? state.year : y);
}
function rampT(key, v) {
  const L = LAYERS[key], d = layerDomain(key);
  let t = clamp01((v - d[0]) / (d[1] - d[0] || 1));
  if (L.scale === 'log') t = Math.log1p(t * 30) / Math.log1p(30);
  else if (L.scale === 'sqrt') t = Math.sqrt(t);
  if (L.invert) t = 1 - t;
  return t;
}
function colorFor(key, v, alpha) {
  const L = LAYERS[key];
  if (v == null) return NEUTRAL;
  if (L.kind === 'cat') {
    const cc = L.cats[v]; if (!cc) return NEUTRAL;
    const rgb = hexToRgb(cc.color);
    return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha == null ? 0.88 : alpha})`;
  }
  const rgb = rampRGB(RAMPS[L.ramp] || RAMPS.heat, rampT(key, v));
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha == null ? 0.88 : alpha})`;
}
const colorSolid = (key, v) => colorFor(key, v, 1);

/* -------------------------------- globe -------------------------------- */
let globe, countries = [];
const elViz = document.getElementById('globeViz');
const tooltip = document.getElementById('tooltip');

function capColor(feat) {
  const iso = isoOf(feat.properties);
  const v = iso ? valOf(iso, state.layer) : null;
  const sel = state.selected && iso === state.selected, hov = state.hovered && iso === state.hovered;
  if (v == null) return (sel || hov) ? 'rgba(140,160,180,0.34)' : (C[iso] ? NEUTRAL : NODATA);
  return colorFor(state.layer, v, sel ? 0.99 : hov ? 0.95 : 0.84);
}
function altOf(feat) {
  const iso = isoOf(feat.properties);
  if (state.selected && iso === state.selected) return 0.055;
  if (state.hovered && iso === state.hovered) return 0.032;
  return 0.008;
}

function initGlobe(geo) {
  countries = geo.features.filter(f => (f.properties.ADMIN || f.properties.NAME) !== 'Antarctica');
  globe = Globe()(elViz)
    .backgroundColor('rgba(0,0,0,0)')
    .showAtmosphere(true).atmosphereColor('#5fd0a8').atmosphereAltitude(0.15)
    .polygonsData(countries).polygonCapColor(capColor)
    .polygonSideColor(() => 'rgba(18,32,44,0.72)').polygonStrokeColor(() => 'rgba(4,10,16,0.85)')
    .polygonAltitude(altOf).polygonsTransitionDuration(280)
    .onPolygonHover(onHover).onPolygonClick(onClick)
    .htmlElement(makeMarker).htmlLat(d => d.lat).htmlLng(d => d.lon)
    .htmlAltitude(d => (d.kind === 'mt' ? 0.05 : 0.014))
    .htmlTransitionDuration(0);
  const mat = globe.globeMaterial();
  mat.color.set('#0d1a24'); mat.emissive.set('#071018'); mat.emissiveIntensity = 0.85; mat.shininess = 7;
  const ctl = globe.controls();
  ctl.autoRotate = true; ctl.autoRotateSpeed = 0.4; ctl.enableDamping = true; ctl.dampingFactor = 0.12;
  ctl.minDistance = 108; ctl.maxDistance = 600;
  globe.onZoom(pov => {
    const before = markerCap();
    state.zoomAlt = pov.altitude;
    if (markerCap() !== before) refreshMarkers();
  });
  globe.pointOfView({ lat: 28, lng: 22, altitude: 2.45 }, 0);
  window.globe = globe;
  sizeGlobe(); requestAnimationFrame(sizeGlobe);
  if (window.ResizeObserver) new ResizeObserver(sizeGlobe).observe(elViz);
  let lastScale = uiScale();
  window.addEventListener('resize', () => {
    if (uiScale() !== lastScale) { lastScale = uiScale(); refreshMarkers(); }
  });
  requestAnimationFrame(() => {
    const cv = elViz.querySelector('canvas');
    if (cv) cv.addEventListener('webglcontextlost', e => { e.preventDefault(); showGlobeError(); });
  });
  refreshMarkers();
}
function sizeGlobe() {
  if (!globe) return;
  const w = elViz.clientWidth || window.innerWidth;
  const h = elViz.clientHeight || (window.innerHeight - 260);
  globe.width(w).height(h);
}
function refreshGlobe() { if (globe) globe.polygonCapColor(capColor).polygonAltitude(altOf); }

/* ---- which markers are visible right now ---- */
function siteActive(s, y) {
  y = y == null ? state.year : y;
  if (s.y0 && y < s.y0) return false;
  if (s.y1 != null && y > s.y1) return false;
  return true;
}
/* How much a site earns its place on screen when there are too many to draw.
   Warheads first, then how sure we are, then what kind of place it is. */
const TYPE_WEIGHT = {
  silo_field: 60, missile_field: 60, deployment_hosted: 70, sub_base: 55, bomber_base: 50,
  mobile_missile_base: 50, air_base: 40, storage: 45, depot: 30, test_site: 55,
  enrichment: 35, reprocessing: 35, reactor: 25, assembly: 30, warhead_lab: 30,
  production: 25, command_bunker: 25, research: 12, mine: 10, proposed: 8,
  former: 6, dismantled: 6, destroyed: 8,
};
const CONF_WEIGHT = { confirmed: 30, high: 22, medium: 12, low: 5, suspected: 8 };
function siteWeight(s) {
  let w = TYPE_WEIGHT[s.type] || 20;
  w += CONF_WEIGHT[s.conf] || 10;
  if (s.wh) w += 40 + Math.min(60, Math.sqrt(s.wh) * 4);
  if (s.bombing) w += 200;
  if (s.status !== 'active') w -= 18;
  if (state.selected && (s.host === state.selected || s.owner === state.selected)) w += 500;
  if (s.owner && s.host && s.owner !== s.host) w += 45;
  return w;
}
/* Cap grows as you zoom in, so a wide view stays readable and fast while a
   close view shows everything that is actually there. */
function markerCap() {
  const a = state.zoomAlt;
  if (a > 1.7) return 300;
  if (a > 1.0) return 460;
  if (a > 0.5) return 700;
  return 4000;
}
let lodTrimmed = 0;
function visibleSites(y) {
  y = y == null ? state.year : y;
  const all = SITES.filter(s => s.lat != null && s.lon != null && state.cats[catOf(s)] && siteActive(s, y));
  const cap = state.flat ? 4000 : markerCap();
  if (all.length <= cap) { lodTrimmed = 0; return all; }
  lodTrimmed = all.length - cap;
  return all.slice().sort((a, b) => siteWeight(b) - siteWeight(a)).slice(0, cap);
}
function markerData() {
  const out = visibleSites().map(s => ({ kind: 'site', id: s.id, lat: s.lat, lon: s.lon, s }));
  // one megatonnage badge per nuclear-armed country, at its arsenal's centre of gravity
  for (const iso in C) {
    const n = seriesAt(iso, state.year);
    if (!n) continue;
    const mt = mtAt(iso, state.year);
    const p = countryCentroid(iso);
    if (!p) continue;
    out.push({ kind: 'mt', id: 'mt-' + iso, iso, lat: p[0], lon: p[1], n, mt });
  }
  // active history-event pins near the current year
  const band = 2;
  EVENTS.forEach(e => {
    if (e.lat == null || e.lon == null) return;
    if (!state.evCats[e.cat]) return;
    if (Math.abs(e.y - state.year) > band && state.selectedEvent !== e.id) return;
    out.push({ kind: 'ev', id: 'ev-' + e.id, lat: e.lat, lon: e.lon, e });
  });
  return out;
}
const CENTROID_CACHE = {};
/* Where a country's badge sits: the middle of its main landmass. */
function countryCentroid(iso) {
  if (CENTROID_CACHE[iso] !== undefined) return CENTROID_CACHE[iso];
  let p = null;
  const f = countries.find(c => isoOf(c.properties) === iso);
  if (f) { const c = polyCentroid(f); p = [c[1], c[0]]; }
  if (!p) {
    const own = SITES.filter(s => (s.owner || s.host) === iso && s.lat != null);
    if (own.length) p = [own[0].lat, own[0].lon];
  }
  CENTROID_CACHE[iso] = p;
  return p;
}
/* Where the deployed arsenal actually is — used for the missile reach rings. */
const ARS_CACHE = {};
function arsenalCentroid(iso) {
  if (ARS_CACHE[iso] !== undefined) return ARS_CACHE[iso];
  const own = SITES.filter(s => (s.owner || s.host) === iso && s.lat != null && siteActive(s, Y1) && catOf(s) === 'deploy');
  let p = null;
  if (own.length) {
    let sw = 0, la = 0, lo = 0;
    own.forEach(s => { const w = (s.wh || 1); sw += w; la += s.lat * w; lo += s.lon * w; });
    p = [la / sw, lo / sw];
  } else p = countryCentroid(iso);
  ARS_CACHE[iso] = p;
  return p;
}
function refreshMarkers() {
  if (globe) globe.htmlElementsData(markerData());
  const note = document.getElementById('gbNote');
  if (note) note.textContent = lodTrimmed
    ? `Showing the ${fmtInt(SITES.length - lodTrimmed)} most significant sites — zoom in for the other ${fmtInt(lodTrimmed)}`
    : 'Click a country for its full nuclear profile · click a marker for the site';
}

/* ------------------------- reach rings (missile range) ------------------------- */
const DELIVERY = window.NUKE_DELIVERY || [];
const REACH_BANDS = [
  { key: 'icbm',  label: 'Intercontinental missiles', color: '#ff4d4d', match: /icbm/i },
  { key: 'slbm',  label: 'Submarine missiles',        color: '#4da3ff', match: /slbm/i },
  { key: 'irbm',  label: 'Intermediate-range',        color: '#ffd23f', match: /irbm|mrbm/i },
  { key: 'short', label: 'Short-range & aircraft',    color: '#2fd66f', match: /srbm|cruise|alcm|slcm|gravity|bomb/i },
];
/* A geodesic circle of radius km around a point, as a closed path. */
function geoCircle(lat, lon, km, steps) {
  const P = window.NukePhysics;
  const n = steps || 96, out = [];
  for (let i = 0; i <= n; i++) out.push(P.destination(lat, lon, i * 360 / n, km));
  return out;
}
function reachRings(iso) {
  const c = arsenalCentroid(iso);
  if (!c) return [];
  const sys = DELIVERY.filter(d => d.iso3 === iso && d.km && d.status !== 'retired' && d.status !== 'development');
  const out = [];
  REACH_BANDS.forEach(b => {
    const inBand = sys.filter(d => b.match.test(d.cls || ''));
    if (!inBand.length) return;
    const best = inBand.reduce((a, d) => (d.km > a.km ? d : a), inBand[0]);
    /* An SLBM's reach is not measured from home — a submarine can be anywhere. */
    if (b.key === 'slbm') return;
    out.push({ band: b, km: best.km, name: best.name, pts: geoCircle(c[0], c[1], Math.min(best.km, 19500)) });
  });
  out.sort((a, b) => b.km - a.km);
  return out;
}
function refreshReach() {
  if (!globe) return;
  const rings = state.reach ? reachRings(state.reach) : [];
  /* Thin lines only: globe.gl's thick-line path renderer does not draw at all
     here, and an animated dash never finishes its transition. Plain 1px lines
     read perfectly well against a dark globe. */
  globe.pathsData(rings)
    .pathPoints(r => r.pts).pathPointLat(p => p[0]).pathPointLng(p => p[1]).pathPointAlt(0.032)
    .pathColor(r => r.band.color)
    .pathStroke(null)
    .pathDashLength(1).pathDashGap(0).pathDashAnimateTime(0)
    .pathTransitionDuration(0);
  const box = document.getElementById('reachKey');
  if (!box) return;
  if (!rings.length) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  box.innerHTML = `<span class="rk-cap">${esc(nameOf(state.reach))} — missile reach</span>` +
    rings.map(r => `<span class="rk-row"><span class="rk-sw" style="background:${r.band.color}"></span>` +
      `<span class="rk-l">${esc(r.name)}</span><span class="rk-v">${fmtInt(r.km)} km</span></span>`).join('') +
    `<button class="rk-close" id="reachClose">Hide</button>` +
    `<span class="rk-note">Drawn from where the arsenal actually sits, not from the capital. Submarine-launched missiles are left out — a submarine can be anywhere, which is the point of them.</span>`;
  document.getElementById('reachClose').addEventListener('click', () => setReach(null));
}
function setReach(iso) {
  state.reach = (state.reach === iso) ? null : iso;
  refreshReach();
  const btn = document.getElementById('detailReach');
  if (btn) btn.classList.toggle('on', !!state.reach);
}

/* One glyph, sized by megatonnage — the size IS the message. */
const mtGlyph = () => '💥';
const uiScale = () => (window.innerWidth < 700 ? 0.72 : window.innerWidth < 1100 ? 0.88 : 1);
function mtSize(mt) {
  if (mt == null) return 14 * uiScale();
  return Math.max(13, Math.min(40, 12 + Math.pow(mt, 0.42) * 1.9)) * uiScale();
}
function makeMarker(d) {
  if (d.kind === 'mt') {
    const el = document.createElement('div');
    el.className = 'nk-mt';
    el.title = nameOf(d.iso) + ' — ' + fmtInt(d.n) + ' warheads, about ' + fmtMt(d.mt) + ' megatons';
    const ic = document.createElement('div');
    ic.className = 'nk-mt-ic'; ic.textContent = mtGlyph(d.mt);
    ic.style.fontSize = mtSize(d.mt) + 'px';
    const lab = document.createElement('div');
    lab.className = 'nk-mt-lab';
    lab.innerHTML = `<span class="nk-mt-n">${fmtInt(d.n)}</span>` +
      (d.mt != null ? `<span class="nk-mt-mt">${fmtMt(d.mt)} Mt</span>` : '');
    el.appendChild(ic); el.appendChild(lab);
    el.addEventListener('click', ev => { ev.stopPropagation(); gotoCountry(d.iso); });
    return el;
  }
  if (d.kind === 'ev') {
    const el = document.createElement('div');
    el.className = 'nk-marker' + (state.selectedEvent === d.e.id ? ' sel big' : '');
    el.title = d.e.t + ' · ' + d.e.y;
    const dot = document.createElement('div');
    dot.className = 'nk-dot ring';
    dot.style.color = evCat(d.e.cat).color;
    el.appendChild(dot);
    el.addEventListener('click', ev => { ev.stopPropagation(); selectEvent(d.e.id, true); });
    return el;
  }
  const s = d.s, cat = SITE_CATS[catOf(s)];
  const el = document.createElement('div');
  el.className = 'nk-marker' + (state.selectedSite === s.id ? ' sel big' : '');
  el.title = s.name + (s.wh ? ' — ' + fmtInt(s.wh) + ' warheads' : '');
  const dot = document.createElement('div');
  dot.className = 'nk-dot ' + cat.shape;
  dot.style.color = siteColor(s);
  const k = uiScale();
  if (s.wh) {
    const g = Math.max(11, Math.min(22, 10 + Math.sqrt(s.wh) * 0.85)) * k;
    if (cat.shape !== 'tri') { dot.style.width = g.toFixed(1) + 'px'; dot.style.height = g.toFixed(1) + 'px'; }
  } else if (k !== 1 && cat.shape !== 'tri') {
    dot.style.width = (10 * k).toFixed(1) + 'px'; dot.style.height = (10 * k).toFixed(1) + 'px';
  }
  el.appendChild(dot);
  if (s.owner && s.host && s.owner !== s.host) {
    const fl = document.createElement('span');
    fl.className = 'nk-flag'; fl.textContent = flagOf(s.owner);
    el.appendChild(fl);
  }
  el.addEventListener('click', ev => { ev.stopPropagation(); selectSite(s.id, true); });
  el.addEventListener('mouseenter', () => showSiteTip(s, el));
  el.addEventListener('mouseleave', () => tooltip.classList.add('hidden'));
  return el;
}
/* Marker COLOUR answers "whose is it, and how sure are we?"; marker SHAPE
   answers "what kind of place is it?". Keeping those on separate channels is
   what lets you read Incirlik as American and Dimona as unconfirmed at a glance. */
function siteColor(s) {
  if (s.status === 'former' || s.status === 'dismantled' || s.status === 'destroyed') return STATUS.former.color;
  if (s.owner && s.host && s.owner !== s.host) return STATUS.host.color;
  const iso = s.owner || s.host;
  const stat = statusAt(iso, state.year);
  if (stat && STATUS[stat]) return STATUS[stat].color;
  if (s.conf === 'suspected' || s.conf === 'low') return STATUS.pursuing.color;
  const c = C[iso];
  if (c && STATUS[c.status]) return STATUS[c.status].color;
  return STATUS.none.color;
}
function showSiteTip(s, el) {
  const owner = s.owner && s.host && s.owner !== s.host;
  let h = `<div class="tt-head"><span class="tt-flag">${flagOf(s.host)}</span><span class="tt-name">${esc(s.name)}</span></div>`;
  h += `<div class="tt-sub">${esc(SITE_CATS[catOf(s)].label)}${s.status && s.status !== 'active' ? ' · ' + esc(s.status) : ''}</div>`;
  if (s.wh) h += `<div class="tt-row"><span>Warheads</span><b>~${fmtInt(s.wh)}</b></div>`;
  if (owner) h += `<div class="tt-row"><span>${flagOf(s.owner)} ${esc(nameOf(s.owner))}'s weapons</span><b></b></div>`;
  const cf = CONF[s.conf];
  if (cf) h += `<span class="tt-chip" style="background:${cf.color}22;color:${cf.color}">${cf.label}</span>`;
  tooltip.innerHTML = h;
  tooltip.classList.remove('hidden');
  const r = elViz.getBoundingClientRect(), er = el.getBoundingClientRect();
  tooltip.style.left = (er.left - r.left) + 'px';
  tooltip.style.top = (er.top - r.top) + 'px';
}

function showGlobeError() {
  if (document.getElementById('glLost')) return;
  const ov = document.createElement('div'); ov.id = 'glLost';
  ov.style.cssText = 'position:absolute;inset:0;z-index:6;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;text-align:center;padding:24px;background:rgba(6,10,14,.78)';
  ov.innerHTML = '<div style="font-size:15px;max-width:380px;line-height:1.55;color:#dbe6ee">The 3D globe lost its graphics context. Reload, or switch to the flat map.</div>';
  const mk = (l, fn) => { const b = document.createElement('button'); b.textContent = l; b.style.cssText = 'padding:9px 16px;border-radius:9px;cursor:pointer;font-weight:600;background:#ffd23f;color:#241a00;border:none;margin:0 5px'; b.onclick = fn; return b; };
  const row = document.createElement('div');
  row.appendChild(mk('↻ Reload', () => location.reload()));
  row.appendChild(mk('🗺 Flat map', () => { ov.remove(); if (!state.flat) setFlat(true); }));
  ov.appendChild(row); elViz.appendChild(ov);
}

/* ---------------------------- hover / tooltip ---------------------------- */
function tooltipHTML(iso, feat) {
  const L = LAYERS[state.layer], v = valOf(iso, state.layer);
  const head = `<div class="tt-head"><span class="tt-flag">${flagOf(iso)}</span><span class="tt-name">${esc(nameOf(iso, feat))}</span></div>`;
  if (!C[iso]) return head + `<div class="tt-nd">No nuclear history</div>`;
  const stat = statusAt(iso, state.year);
  let h = head;
  if (stat) h += `<span class="tt-chip" style="background:${st(stat).color}22;color:${st(stat).color}">${st(stat).label}</span>`;
  const n = seriesAt(iso, state.year);
  if (n) {
    h += `<div class="tt-val" style="margin-top:6px"><b>${fmtInt(n)}</b> warheads</div>`;
    const mt = mtAt(iso, state.year);
    if (mt != null) h += `<div class="tt-sub">about ${fmtMt(mt)} megatons in total</div>`;
  } else if (L.kind !== 'cat' && v != null) {
    h += `<div class="tt-val" style="margin-top:6px"><b>${fmtNum(v, L.fmt)}</b>${L.unit || ''}</div><div class="tt-sub">${esc(L.label)}</div>`;
  } else if (!stat) {
    h += `<div class="tt-nd">No warheads</div>`;
  }
  if (L.kind !== 'cat' && n && state.layer !== 'warheads' && v != null) {
    h += `<div class="tt-row"><span>${esc(L.label)}</span><b>${fmtNum(v, L.fmt)}${L.unit || ''}</b></div>`;
  }
  const ns = SITES.filter(s => (s.host === iso || s.owner === iso) && siteActive(s)).length;
  if (ns) h += `<div class="tt-sub" style="margin-top:5px">${ns} mapped site${ns > 1 ? 's' : ''} · click for the full profile</div>`;
  return h;
}
function onHover(feat) {
  const iso = feat ? isoOf(feat.properties) : null;
  state.hovered = iso; refreshGlobe();
  if (globe) globe.controls().autoRotate = !feat && spinOn && !state.playing;
  if (!feat) { tooltip.classList.add('hidden'); return; }
  tooltip.innerHTML = tooltipHTML(iso, feat);
  tooltip.classList.remove('hidden');
}
elViz.addEventListener('mousemove', e => {
  if (tooltip.classList.contains('hidden')) return;
  const r = elViz.getBoundingClientRect();
  tooltip.style.left = (e.clientX - r.left) + 'px';
  tooltip.style.top = (e.clientY - r.top) + 'px';
});

/* Centroid of the LARGEST ring only. A whole-feature bounding box puts the
   United States in the Pacific (because of Alaska and Hawaii) and Russia in
   the Arctic (because Chukotka crosses the dateline); the biggest landmass is
   what people actually mean by "the middle of the country". */
const CENT_CACHE = new WeakMap();
function polyCentroid(feat) {
  if (CENT_CACHE.has(feat)) return CENT_CACHE.get(feat);
  const polys = feat.geometry.type === 'Polygon' ? [feat.geometry.coordinates] : feat.geometry.coordinates;
  let best = null, bestA = -1;
  for (const poly of polys) {
    const ring = poly[0];
    if (!ring || ring.length < 4) continue;
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, n = ring.length - 1; i < n; i++) {
      const [x0, y0] = ring[i], [x1, y1] = ring[i + 1];
      const f = x0 * y1 - x1 * y0;
      a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
    }
    a /= 2;
    const area = Math.abs(a);
    if (area > bestA && area > 1e-9) { bestA = area; best = [cx / (6 * a), cy / (6 * a)]; }
  }
  if (!best) {
    let mnx = 180, mny = 90, mxx = -180, mxy = -90;
    const walk = c => { if (typeof c[0] === 'number') { mnx = Math.min(mnx, c[0]); mxx = Math.max(mxx, c[0]); mny = Math.min(mny, c[1]); mxy = Math.max(mxy, c[1]); } else c.forEach(walk); };
    walk(feat.geometry.coordinates);
    best = [(mnx + mxx) / 2, (mny + mxy) / 2];
  }
  CENT_CACHE.set(feat, best);
  return best;
}

function onClick(feat) {
  if (!feat) return;
  const iso = isoOf(feat.properties);
  state.selected = iso; state.selectedSite = null; state.selectedEvent = null;
  hide('siteCard'); hide('eventCard');
  refreshGlobe(); refreshMarkers(); showDetail(iso, feat);
  const [lng, lat] = polyCentroid(feat);
  if (globe && !state.flat) { globe.controls().autoRotate = false; globe.pointOfView({ lat, lng, altitude: 1.75 }, 800); }
  spinOn = false; syncSpin();
}

const hide = id => document.getElementById(id).classList.add('hidden');
const show = id => document.getElementById(id).classList.remove('hidden');

/* ---------------------------- country detail ---------------------------- */
const detailCard = document.getElementById('detailCard');
function showDetail(iso, feat) {
  const c = C[iso];
  show('detailCard');
  document.getElementById('detailFlag').textContent = flagOf(iso);
  document.getElementById('detailName').textContent = nameOf(iso, feat);

  const y = state.year;
  const n = seriesAt(iso, y), mt = mtAt(iso, y), stat = statusAt(iso, y);
  document.getElementById('detailSub').textContent = c
    ? (y === Y1 ? 'Nuclear profile · 2026' : 'Nuclear profile · as of ' + y)
    : 'No nuclear history recorded';

  const badge = document.getElementById('detailStatus');
  if (stat) {
    const s = st(stat);
    badge.style.display = '';
    badge.style.background = s.color + '22'; badge.style.color = s.color;
    badge.textContent = s.glyph + ' ' + s.label;
  } else badge.style.display = 'none';

  const hero = document.getElementById('detailHero');
  if (c && n) {
    const share = globalAt(y).n ? (n / globalAt(y).n * 100) : null;
    const inv = (y === Y1 && c.wh && c.wh.total != null && c.wh.total !== n) ? c.wh.total : null;
    hero.style.display = '';
    hero.innerHTML =
      `<div class="hero-cell" title="Warheads assigned to the armed forces"><div class="hero-n">${fmtInt(n)}</div><div class="hero-l">in stockpile</div></div>` +
      (inv
        ? `<div class="hero-cell" title="Stockpile plus warheads retired but not yet taken apart"><div class="hero-n">${fmtInt(inv)}</div><div class="hero-l">total incl. retired</div></div>`
        : `<div class="hero-cell"><div class="hero-n">${fmtShare(share)}</div><div class="hero-l">of world total</div></div>`) +
      `<div class="hero-cell" title="Combined explosive yield"><div class="hero-n">${fmtMt(mt)}</div><div class="hero-l">megatons</div></div>`;
  } else hero.style.display = 'none';

  const box = document.getElementById('detailMetrics');
  if (!c) {
    box.innerHTML = '<div class="tt-nd" style="padding:8px 4px">This country has no nuclear weapons and no recorded weapons programme.</div>';
    document.getElementById('detailSites').innerHTML = '';
    document.getElementById('detailNarrative').textContent = '';
    document.getElementById('detailDates').innerHTML = '';
    document.getElementById('detailSrc').innerHTML = '';
    document.querySelector('.detail-actions').style.display = 'none';
    return;
  }
  document.querySelector('.detail-actions').style.display = '';
  const hasReach = DELIVERY.some(d => d.iso3 === iso && d.km);
  const rb = document.getElementById('detailReach');
  rb.style.display = hasReach ? '' : 'none';
  rb.classList.toggle('on', state.reach === iso);

  const rows = [];
  const push = (l, v, sub) => { if (v != null && v !== '' && v !== '—') rows.push(`<div class="mrow${sub ? ' sub' : ''}"><span class="m-l">${esc(l)}</span><span class="m-v">${v}</span></div>`); };
  const w = (y === Y1 && c.wh) ? c.wh : null;
  if (w) {
    if (w.dep != null) push('Deployed, strategic', fmtInt(w.dep), true);
    if (w.nonstrat != null) push('Deployed, non-strategic', fmtInt(w.nonstrat), true);
    if (w.res != null) push('Reserve / stored', fmtInt(w.res), true);
    if (w.mil != null) push('Military stockpile', '<b>' + fmtInt(w.mil) + '</b>');
    if (w.ret != null) push('Retired, awaiting dismantling', fmtInt(w.ret), true);
    if (w.total != null) push('Total inventory', '<b>' + fmtInt(w.total) + '</b>');
  } else if (n) push('Warheads', fmtInt(n));
  if (c.mt && c.mt.est != null && y === Y1) {
    push('Total yield', fmtMt(c.mt.est) + ' Mt');
    if (c.mt.lo != null && c.mt.hi != null) push('Estimate range', fmtMt(c.mt.lo) + '–' + fmtMt(c.mt.hi) + ' Mt', true);
  }
  if (c.tests) push('Nuclear tests', fmtInt(testsBy(iso, y)));
  if (c.firstTest) push('First test', c.firstTest.slice(0, 10));
  if (c.peak && c.peak.n) push('Peak arsenal', fmtInt(c.peak.n) + ' in ' + c.peak.y);
  if (c.delivery && c.delivery.triad != null) push('Full triad', c.delivery.triad ? 'Yes' : 'No');
  if (c.nfu != null) push('No-first-use pledge', c.nfu ? 'Yes' : 'No');
  if (c.launchAuth) push('Launch authority', '<span style="font-weight:600;font-size:11px">' + esc(c.launchAuth) + '</span>');
  if (c.dem && c.dem.eiu != null) push('Democracy Index', c.dem.eiu.toFixed(2) + ' <span style="font-weight:500;color:#8c9cab;font-size:10.5px">' + esc(c.dem.cat || '') + '</span>');
  if (c.npt) push('NPT', esc(c.npt));
  if (c.tpnw) push('Ban treaty (TPNW)', esc(c.tpnw));
  if (c.ctbt) push('Test-ban treaty', esc(c.ctbt));
  box.innerHTML = rows.join('');

  // sites
  const mine = SITES.filter(s => (s.host === iso || s.owner === iso) && siteActive(s, y) && s.lat != null)
    .sort((a, b) => (b.wh || 0) - (a.wh || 0) || a.name.localeCompare(b.name));
  const sbox = document.getElementById('detailSites');
  sbox.innerHTML = mine.length
    ? `<div class="sec-cap">${mine.length} mapped site${mine.length > 1 ? 's' : ''}</div>` + mine.slice(0, 40).map(s =>
        `<div class="ds-row" data-site="${esc(s.id)}"><span class="ds-sw" style="background:${siteColor(s)}"></span>` +
        `<span class="ds-l">${s.owner && s.host && s.owner !== s.host ? flagOf(s.owner) + ' ' : ''}${esc(s.name)}</span>` +
        `<span class="ds-v">${s.wh ? '~' + fmtInt(s.wh) : esc(SITE_CATS[catOf(s)].label.split(' ')[0])}</span></div>`).join('')
      + (mine.length > 40 ? `<div class="ds-row" style="cursor:default"><span class="ds-l" style="color:#8c9cab">…and ${mine.length - 40} more</span></div>` : '')
    : '';

  document.getElementById('detailNarrative').textContent = c.narrative || '';
  const nb = document.getElementById('detailNotes');
  nb.innerHTML = (c.notes && c.notes.length && y === Y1)
    ? '<div class="sec-cap">Worth knowing</div>' + c.notes.map(x => `<div class="dn-row">${esc(x)}</div>`).join('')
    : '';
  const dd = (c.keyDates || []).filter(d => d.year <= y || y === Y1);
  document.getElementById('detailDates').innerHTML = dd.length
    ? '<div class="sec-cap">Key moments</div>' + dd.map(d => `<div class="dd-row"><span class="dd-y">${d.year}</span><span class="dd-t">${esc(d.label)}</span></div>`).join('')
    : '';
  document.getElementById('detailSrc').innerHTML = srcHTML(c.sources);
}
function srcHTML(list) {
  if (!list || !list.length) return '';
  return '<div class="ev-src-cap">Sources</div>' + list.slice(0, 8).map(s =>
    s.url ? `<a class="src-tag" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || s.url)}</a>`
          : `<span class="src-tag">${esc(s.title || s)}</span>`).join('');
}
document.getElementById('detailClose').addEventListener('click', () => {
  hide('detailCard'); state.selected = null; setReach(null);
  refreshGlobe(); if (state.flat) syncFlatSelection();
});
document.getElementById('detailReach').addEventListener('click', () => {
  if (state.selected) setReach(state.selected);
});
document.getElementById('detailSites').addEventListener('click', e => {
  const r = e.target.closest('.ds-row'); if (r && r.dataset.site) selectSite(r.dataset.site, true);
});

/* ------------------------------ site detail ------------------------------ */
function selectSite(id, fly) {
  const s = SITE_BY_ID[id]; if (!s) return;
  state.selectedSite = id; state.selectedEvent = null;
  hide('eventCard'); show('siteCard');
  refreshMarkers();

  document.getElementById('siteGlyph').textContent =
    ({ deploy: '🚀', store: '🏔', make: '⚙️', test: '☢️', gone: '⌀' })[catOf(s)] || '◉';
  document.getElementById('siteName').textContent = s.name;
  const bits = [SITE_CATS[catOf(s)].label, nameOf(s.host)];
  if (s.status && s.status !== 'active') bits.push(s.status);
  document.getElementById('siteSub').textContent = bits.join(' · ');

  const ownerBox = document.getElementById('siteOwner');
  if (s.owner && s.host && s.owner !== s.host) {
    ownerBox.style.display = '';
    const own = nameOf(s.owner), hostN = nameOf(s.host);
    ownerBox.innerHTML = `<span class="of">${flagOf(s.owner)}</span><div>These are <b>${esc(possessive(own))}</b> weapons, stationed on ${esc(possessive(hostN))} territory. ${esc(theName(hostN))} does not own them and cannot use them alone.</div>`;
  } else ownerBox.style.display = 'none';

  const rows = [];
  const push = (l, v) => { if (v != null && v !== '') rows.push(`<div class="mrow"><span class="m-l">${esc(l)}</span><span class="m-v">${v}</span></div>`); };
  if (s.wh) push('Warheads held', '~' + fmtInt(s.wh));
  if (s.whNote) push('', '<span style="font-weight:500;font-size:11px;color:#8c9cab">' + esc(s.whNote) + '</span>');
  if (s.weapons && s.weapons.length) push('Weapons', '<span style="font-weight:600;font-size:11.5px">' + esc(s.weapons.join(', ')) + '</span>');
  if (s.systems && s.systems.length) push('Delivery', '<span style="font-weight:600;font-size:11.5px">' + esc(s.systems.join(', ')) + '</span>');
  if (s.yieldKt && s.yieldKt.length) push('Yield', s.yieldKt.map(k => k >= 1000 ? (k / 1000) + ' Mt' : k + ' kt').join(' / '));
  if (s.tests) push('Nuclear tests here', fmtInt(s.tests));
  if (s.totalYieldMt) push('Total yield tested', fmtMt(s.totalYieldMt) + ' Mt');
  if (s.y0) push('Active from', s.y0 + (s.y1 ? ' to ' + s.y1 : ''));
  if (s.lat != null && s.lon != null) {
    push('Coordinates', `<span style="font-weight:600;font-size:11px;font-variant-numeric:tabular-nums">${s.lat.toFixed(3)}°, ${s.lon.toFixed(3)}°</span>`);
  } else {
    push('Coordinates', '<span style="font-weight:600;font-size:11px;color:#8c9cab">not published</span>');
  }
  const cf = CONF[s.conf];
  if (cf) rows.push(`<div class="mrow"><span class="m-l">Certainty</span><span class="m-v"><span class="conf-chip" style="background:${cf.color}22;color:${cf.color}">${cf.label}</span></span></div>`);
  document.getElementById('siteFacts').innerHTML = rows.join('');
  document.getElementById('siteDesc').textContent = s.desc || '';
  document.getElementById('siteSrc').innerHTML = srcHTML(s.sources);

  if (fly && s.lat != null) flyTo(s.lat, s.lon, 0.7);
}
document.getElementById('siteClose').addEventListener('click', () => { hide('siteCard'); state.selectedSite = null; refreshMarkers(); });
document.getElementById('siteZoom').addEventListener('click', () => {
  const s = SITE_BY_ID[state.selectedSite];
  if (!s) return;
  if (s.lat == null) { showToast('No published coordinate for this site'); return; }
  flyTo(s.lat, s.lon, 0.35);
});
function flyTo(lat, lon, alt) {
  if (state.flat) { flyFlatTo(lon, lat); return; }
  if (!globe) return;
  globe.controls().autoRotate = false; spinOn = false; syncSpin();
  globe.pointOfView({ lat, lng: lon, altitude: alt == null ? 0.9 : alt }, 900);
}

/* ------------------------------ event card ------------------------------ */
function selectEvent(id, fly) {
  const e = EV_BY_ID[id]; if (!e) return;
  state.selectedEvent = id; state.selectedSite = null;
  hide('siteCard'); show('eventCard');
  const cat = evCat(e.cat);
  document.getElementById('evCatDot').style.background = cat.color;
  document.getElementById('evCat').textContent = cat.label;
  document.getElementById('evTitle').textContent = e.t;
  const where = e.iso3 ? nameOf(e.iso3) : '';
  document.getElementById('evMeta').textContent = [e.date || e.y, where].filter(Boolean).join(' · ');
  document.getElementById('evBlurb').textContent = e.b || '';
  const sw = document.getElementById('evSrcWrap');
  const html = srcHTML(e.src);
  if (html) { sw.style.display = ''; document.getElementById('evSrc').innerHTML = html.replace('<div class="ev-src-cap">Sources</div>', ''); }
  else sw.style.display = 'none';
  if (Math.abs(e.y - state.year) > 2) { state.year = e.y; applyYear(true); }
  refreshMarkers(); updateTimelineState();
  if (fly && e.lat != null) flyTo(e.lat, e.lon, 1.1);
}
document.getElementById('eventClose').addEventListener('click', () => { hide('eventCard'); state.selectedEvent = null; refreshMarkers(); updateTimelineState(); });

/* -------------------------- layer + legend + list -------------------------- */
const layerSel = document.getElementById('layerSel');
layerSel.innerHTML = LAYER_ORDER.map(k => `<option value="${k}">${LAYERS[k].label}</option>`).join('');
layerSel.addEventListener('change', () => setLayer(layerSel.value));
function setLayer(k) {
  if (!LAYERS[k]) return;
  state.layer = k; layerSel.value = k;
  document.getElementById('layerDesc').textContent = LAYERS[k].desc || '';
  if (state.flat) updateFlatColors(); else refreshGlobe();
  updateLegend(); updateGlobal();
  if (state.selected) showDetail(state.selected, countries.find(c => isoOf(c.properties) === state.selected));
}
function updateLegend() {
  const L = LAYERS[state.layer], el = document.getElementById('legend');
  if (L.kind === 'cat') {
    const order = L.order || Object.keys(L.cats);
    el.innerHTML = '<div class="cat-legend">' + order.map(k => {
      const n = Object.keys(C).filter(iso => valOf(iso, state.layer) === k).length;
      if (!n && k === 'none') return '';
      return `<div class="cat-row" title="${esc((L.cats[k].desc || ''))}"><span class="cat-sw" style="background:${L.cats[k].color}"></span><span style="flex:1">${esc(L.cats[k].label)}</span><span class="cat-n">${n}</span></div>`;
    }).join('') + '</div>';
  } else {
    const d = layerDomain(state.layer);
    const stops = [];
    for (let i = 0; i <= 10; i++) {
      const v = d[0] + (d[1] - d[0]) * (i / 10);
      const c = rampRGB(RAMPS[L.ramp] || RAMPS.heat, rampT(state.layer, v));
      stops.push(`rgb(${c[0]},${c[1]},${c[2]}) ${(i / 10 * 100).toFixed(0)}%`);
    }
    el.innerHTML = `<div class="ramp-bar" style="background:linear-gradient(90deg,${stops.join(',')})"></div>` +
      `<div class="ramp-ends"><span>${fmtNum(d[0], L.fmt)}${L.unit || ''}</span><span>${fmtNum(d[1], L.fmt)}${L.unit || ''}</span></div>`;
  }
}
function updateGlobal() {
  const L = LAYERS[state.layer];
  const statEl = document.getElementById('gbStat'), lblEl = document.getElementById('gbStatLabel');
  const sv = L.stat ? L.stat(state.year) : null;
  statEl.textContent = sv == null ? '—' : fmtNum(sv, L.statFmt || 'int');
  lblEl.textContent = L.statLabel || '';

  let rows = Object.keys(C).map(iso => ({ iso, n: nameOf(iso), v: valOf(iso, state.layer), wh: seriesAt(iso, state.year) }));
  if (L.kind === 'cat') {
    const order = L.order || Object.keys(L.cats);
    rows = rows.filter(r => r.v != null).sort((a, b) =>
      order.indexOf(a.v) - order.indexOf(b.v) || (b.wh || 0) - (a.wh || 0) || a.n.localeCompare(b.n));
    document.getElementById('gbRows').innerHTML = rows.map(r =>
      `<div class="gb-row" data-iso="${r.iso}"><span class="gb-sw" style="background:${colorSolid(state.layer, r.v)}"></span>` +
      `<span class="gb-fl">${flagOf(r.iso)}</span><span class="gb-l">${esc(r.n)}</span>` +
      `<span class="gb-v">${r.wh ? fmtInt(r.wh) : ''}</span></div>`).join('');
  } else {
    rows = rows.filter(r => r.v != null && r.v > 0).sort((a, b) => (L.sortAsc ? a.v - b.v : b.v - a.v));
    document.getElementById('gbRows').innerHTML = rows.map((r, i) =>
      `<div class="gb-row" data-iso="${r.iso}"><span class="gb-rank">${i + 1}</span>` +
      `<span class="gb-fl">${flagOf(r.iso)}</span><span class="gb-l">${esc(r.n)}</span>` +
      `<span class="gb-v">${fmtNum(r.v, L.fmt)}${L.unit || ''}</span></div>`).join('');
  }
}
document.getElementById('gbRows').addEventListener('click', e => {
  const r = e.target.closest('.gb-row'); if (r) gotoCountry(r.dataset.iso);
});

/* the key collapses on phones so the map is not buried */
const legendBox = document.getElementById('legendBox');
document.getElementById('legendToggle').addEventListener('click', () => legendBox.classList.toggle('collapsed'));
if (window.matchMedia && window.matchMedia('(max-width:700px)').matches) legendBox.classList.add('collapsed');

/* site-category toggles */
function buildToggles() {
  document.getElementById('siteToggles').innerHTML = CAT_ORDER.map(k =>
    `<button class="stog${state.cats[k] ? ' on' : ''}" data-cat="${k}" title="${esc(SITE_CATS[k].types.join(', ').replace(/_/g, ' '))}">` +
    `<span class="sw sw-${SITE_CATS[k].shape}"></span>${esc(SITE_CATS[k].label)}</button>`).join('') +
    '<div class="stog-note"><b>Shape</b> is what the site is. <b>Colour</b> is whose weapons are there and how certain that is — the key above.</div>';
}
document.getElementById('siteToggles').addEventListener('click', e => {
  const b = e.target.closest('.stog'); if (!b) return;
  state.cats[b.dataset.cat] = !state.cats[b.dataset.cat];
  buildToggles(); refreshMarkers(); if (state.flat) updateFlatMarkers();
});

/* ============================ timeline ============================ */
const TLW = 1000, X0 = 16, X1 = 984, TOP = 8, AREA_H = 50, DOTY = 66, AXISY = 80;
const tlChart = document.getElementById('tlChart');
const NYEARS = Y1 - Y0;
const xOfYear = y => X0 + ((y - Y0) / NYEARS) * (X1 - X0);
const yearOfX = x => Math.round(Y0 + (x - X0) / (X1 - X0) * NYEARS);

/* stacked area of warhead inventories */
const AREA_ORDER = ['RUS', 'USA', 'FRA', 'CHN', 'GBR', 'PAK', 'IND', 'ISR', 'PRK', 'ZAF', 'UKR', 'KAZ', 'BLR'];
const AREA_COLOR = { RUS: '#ff4d4d', USA: '#4da3ff', FRA: '#7c9dff', CHN: '#ffd23f', GBR: '#6fd2c8', PAK: '#2fd66f',
  IND: '#ff8c1a', ISR: '#ffc93c', PRK: '#c07cff', ZAF: '#b57cff', UKR: '#f7d774', KAZ: '#9fd6a0', BLR: '#e089c0' };
let TL_MAX = 1;
function buildTimeline() {
  const years = [];
  for (let y = Y0; y <= Y1; y++) years.push(y);
  TL_MAX = Math.max(1, ...years.map(y => globalAt(y).n || 0));

  const stackY = y => {
    let acc = 0; const out = {};
    AREA_ORDER.forEach(iso => { const n = seriesAt(iso, y) || 0; out[iso] = [acc, acc + n]; acc += n; });
    return out;
  };
  const yPix = v => TOP + AREA_H - (Math.sqrt(v / TL_MAX)) * AREA_H;

  let svg = '';
  // gridlines
  const gridVals = TL_MAX > 40000 ? [5000, 20000, 60000] : TL_MAX > 8000 ? [1000, 5000, 12000] : TL_MAX > 800 ? [200, 800, 2000] : [20, 100, 400];
  gridVals.forEach(v => {
    if (v > TL_MAX) return;
    const yy = yPix(v);
    svg += `<line class="tl-gridline" x1="${X0}" y1="${yy.toFixed(1)}" x2="${X1}" y2="${yy.toFixed(1)}"/>`;
    svg += `<text class="tl-glab" x="${X0 + 3}" y="${(yy - 2.5).toFixed(1)}">${fmtCompact(v)}</text>`;
  });
  const stacks = years.map(stackY);
  AREA_ORDER.forEach(iso => {
    if (!SERIES[iso]) return;
    let up = '', down = '';
    years.forEach((y, i) => { up += (i ? 'L' : 'M') + xOfYear(y).toFixed(1) + ',' + yPix(stacks[i][iso][1]).toFixed(1); });
    for (let i = years.length - 1; i >= 0; i--) down += 'L' + xOfYear(years[i]).toFixed(1) + ',' + yPix(stacks[i][iso][0]).toFixed(1);
    svg += `<path class="tl-area" d="${up}${down}Z" fill="${AREA_COLOR[iso] || '#8c9cab'}" opacity="0.72"><title>${esc(nameOf(iso))}</title></path>`;
  });

  // axis
  svg += `<line class="tl-axis" x1="${X0}" y1="${AXISY}" x2="${X1}" y2="${AXISY}"/>`;
  for (let y = 1940; y <= Y1; y += 10) {
    const x = xOfYear(y);
    svg += `<line class="tl-axis" x1="${x.toFixed(1)}" y1="${AXISY}" x2="${x.toFixed(1)}" y2="${AXISY + 3}"/>`;
    svg += `<text class="tl-tick" x="${x.toFixed(1)}" y="${AXISY + 12}" text-anchor="middle">${y}</text>`;
  }
  // event dots
  const lanes = {};
  for (const e of EVENTS) {
    if (!state.evCats[e.cat]) continue;
    const x = xOfYear(e.y);
    const key = Math.round(x / 6);
    lanes[key] = (lanes[key] || 0) + 1;
    const dy = ((lanes[key] - 1) % 2) * 8;
    svg += `<circle class="tl-dot" data-ev="${esc(e.id)}" cx="${x.toFixed(1)}" cy="${DOTY - dy}" r="${e.imp >= 4 ? 5 : 3.6}" fill="${evCat(e.cat).color}" stroke="rgba(4,8,14,.6)" stroke-width="1"><title>${esc(e.y + ' — ' + e.t)}</title></circle>`;
  }
  svg += `<line id="tlPlay" class="tl-playhead" x1="${xOfYear(state.year).toFixed(1)}" y1="${TOP - 4}" x2="${xOfYear(state.year).toFixed(1)}" y2="${AXISY + 4}"/>`;
  svg += `<circle id="tlPlayGrip" class="tl-playhead-grip" cx="${xOfYear(state.year).toFixed(1)}" cy="${TOP - 4}" r="3.5"/>`;
  tlChart.innerHTML = svg;
  tlChart.querySelectorAll('.tl-dot').forEach(d => d.addEventListener('click', ev => { ev.stopPropagation(); selectEvent(d.dataset.ev, true); }));

  document.getElementById('tlKey').innerHTML = Object.keys(EVENT_CATS).map(k =>
    `<span class="tk${state.evCats[k] ? '' : ' off'}" data-ec="${k}"><span class="tk-sw" style="background:${EVENT_CATS[k].color}"></span>${EVENT_CATS[k].label}</span>`).join('');
  updateTimelineState();
}
document.getElementById('tlKey').addEventListener('click', e => {
  const t = e.target.closest('.tk'); if (!t) return;
  state.evCats[t.dataset.ec] = !state.evCats[t.dataset.ec];
  buildTimeline(); refreshMarkers();
});
function updateTimelineState() {
  const px = xOfYear(state.year).toFixed(1);
  const pl = document.getElementById('tlPlay'), pg = document.getElementById('tlPlayGrip');
  if (pl) { pl.setAttribute('x1', px); pl.setAttribute('x2', px); }
  if (pg) pg.setAttribute('cx', px);
  tlChart.querySelectorAll('.tl-dot').forEach(d => {
    const e = EV_BY_ID[d.dataset.ev]; if (!e) return;
    const near = Math.abs(e.y - state.year) <= 2, s = state.selectedEvent === e.id;
    d.classList.toggle('sel', s);
    d.style.opacity = s ? 1 : near ? 1 : 0.42;
  });
  const g = globalAt(state.year);
  document.getElementById('yearLabel').textContent = state.year;
  const badge = document.getElementById('yearBadge');
  const ns = nuclearStatesAt(state.year);
  badge.textContent = ns ? ns + (ns === 1 ? ' nuclear state' : ' nuclear states') : 'no nuclear weapons';
  document.getElementById('yearStat').textContent = g.n
    ? fmtInt(g.n) + ' warheads in military stockpiles' +
      (state.year === Y1 && META.worldInventory ? ' · ' + fmtInt(META.worldInventory) + ' including those awaiting dismantling' : '')
    : '';
  document.getElementById('nowBtn').textContent = String(Y1);
}
function tlScrub(clientX) {
  const r = tlChart.getBoundingClientRect();
  const vx = (clientX - r.left) / r.width * TLW;
  gotoYear(Math.max(Y0, Math.min(Y1, yearOfX(vx))));
}
let tlDragging = false;
tlChart.addEventListener('pointerdown', e => { if (e.target.classList.contains('tl-dot')) return; tlDragging = true; tlChart.setPointerCapture(e.pointerId); tlScrub(e.clientX); });
tlChart.addEventListener('pointermove', e => { if (tlDragging) tlScrub(e.clientX); });
tlChart.addEventListener('pointerup', e => { tlDragging = false; try { tlChart.releasePointerCapture(e.pointerId); } catch (err) {} });

const slider = document.getElementById('timeSlider');
slider.min = Y0; slider.max = Y1; slider.value = Y1;
function applyYear(skipMarkers) {
  slider.value = state.year;
  updateTimelineState();
  if (state.flat) updateFlatColors(); else refreshGlobe();
  if (!skipMarkers) refreshMarkers();
  if (state.flat) updateFlatMarkers();
  updateLegend(); updateGlobal();
  if (state.selected) showDetail(state.selected, countries.find(c => isoOf(c.properties) === state.selected));
}
function gotoYear(y) { state.year = y; stopPlay(); applyYear(); }
slider.addEventListener('input', () => gotoYear(parseInt(slider.value, 10)));
document.getElementById('prevEra').addEventListener('click', () => gotoYear(Math.max(Y0, state.year - 1)));
document.getElementById('nextEra').addEventListener('click', () => gotoYear(Math.min(Y1, state.year + 1)));
document.getElementById('nowBtn').addEventListener('click', () => gotoYear(Y1));

const playBtn = document.getElementById('playBtn'), playRevBtn = document.getElementById('playRevBtn');
function syncPlayBtns() {
  const f = state.playing && state.playDir > 0, r = state.playing && state.playDir < 0;
  playBtn.textContent = f ? '⏸' : '▶'; playBtn.classList.toggle('on', f);
  playRevBtn.textContent = r ? '⏸' : '◀'; playRevBtn.classList.toggle('on', r);
}
function stopPlay() {
  state.playing = false;
  if (playTimer) { clearInterval(playTimer); playTimer = null; }
  syncPlayBtns();
  if (globe) globe.controls().autoRotate = spinOn && !state.flat;
}
function startPlay(dir) {
  state.playDir = dir;
  if (dir > 0 && state.year >= Y1) state.year = Y0;
  if (dir < 0 && state.year <= Y0) state.year = Y1;
  state.playing = true; syncPlayBtns();
  if (globe) globe.controls().autoRotate = false;
  applyYear();
  playTimer = setInterval(() => {
    const nx = state.year + state.playDir;
    if (nx < Y0 || nx > Y1) { stopPlay(); return; }
    state.year = nx; applyYear();
  }, 190);
}
playBtn.addEventListener('click', () => (state.playing && state.playDir > 0) ? stopPlay() : startPlay(1));
playRevBtn.addEventListener('click', () => (state.playing && state.playDir < 0) ? stopPlay() : startPlay(-1));

/* ============================ flat map ============================ */
const FW = 2000, FH = 1000;
const fpx = lon => (lon + 180) / 360 * FW, fpy = lat => (90 - lat) / 180 * FH;
const geomOf = f => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates);
function flatPathD(f) {
  let d = '';
  for (const poly of geomOf(f)) for (const ring of poly) d += 'M' + ring.map(p => fpx(p[0]).toFixed(1) + ',' + fpy(p[1]).toFixed(1)).join('L') + 'Z';
  return d;
}
let flatBuilt = false;
function buildFlatMap() {
  const svg = document.getElementById('flatViz');
  let s = `<rect class="flat-ocean" x="0" y="0" width="${FW}" height="${FH}"/><g id="flatCells">`;
  countries.forEach(f => {
    const iso = isoOf(f.properties);
    s += `<path class="flat-cell" data-iso="${iso}" d="${flatPathD(f)}" fill="${NODATA}"/>`;
  });
  s += '</g><g id="flatHits">';
  countries.forEach(f => {
    const iso = isoOf(f.properties);
    s += `<path class="flat-hit" data-iso="${iso}" d="${flatPathD(f)}"/>`;
  });
  s += '</g><g id="flatMarkers"></g>';
  svg.innerHTML = s;
  svg.setAttribute('viewBox', `0 0 ${FW} ${FH}`);
  flatBuilt = true;
  svg.querySelectorAll('.flat-hit').forEach(el => {
    el.addEventListener('mousemove', e => flatHover(el.dataset.iso, e));
    el.addEventListener('mouseleave', () => tooltip.classList.add('hidden'));
    el.addEventListener('click', e => {
      if (flatPanned) return;
      e.stopPropagation();
      const f = countries.find(c => isoOf(c.properties) === el.dataset.iso);
      if (f) onClick(f);
    });
  });
  updateFlatColors(); updateFlatMarkers(); initFlatInteract();
}
function updateFlatColors() {
  if (!flatBuilt) return;
  document.querySelectorAll('.flat-cell').forEach(el => {
    const iso = el.dataset.iso, v = valOf(iso, state.layer);
    el.setAttribute('fill', v == null ? (C[iso] ? NEUTRAL : NODATA) : colorFor(state.layer, v, 0.9));
  });
  syncFlatSelection();
}
function updateFlatMarkers() {
  if (!flatBuilt) return;
  const g = document.getElementById('flatMarkers');
  const sc = Math.max(0.35, Math.min(1.6, flatView.w / FW * 1.6));
  let s = '';
  visibleSites().forEach(site => {
    const x = fpx(site.lon), y = fpy(site.lat);
    const r = (site.wh ? Math.max(3.2, Math.min(9, 3 + Math.sqrt(site.wh) * 0.34)) : 3.2) * sc;
    s += `<circle class="flat-site" data-site="${esc(site.id)}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${siteColor(site)}" stroke="rgba(0,0,0,.6)" stroke-width="${(0.8 * sc).toFixed(2)}" opacity="0.95"><title>${esc(site.name)}</title></circle>`;
    if (site.owner && site.host && site.owner !== site.host) {
      s += `<text class="flat-site" data-site="${esc(site.id)}" x="${(x + r + 1).toFixed(1)}" y="${(y - r).toFixed(1)}" font-size="${(11 * sc).toFixed(1)}">${flagOf(site.owner)}</text>`;
    }
  });
  g.innerHTML = s;
  g.querySelectorAll('.flat-site').forEach(el => el.addEventListener('click', e => { e.stopPropagation(); if (!flatPanned) selectSite(el.dataset.site, false); }));
}
function syncFlatSelection() {
  if (flatBuilt) document.querySelectorAll('.flat-hit').forEach(el => el.classList.toggle('sel', el.dataset.iso === state.selected));
}
function flatHover(iso, e) {
  if (flatDragging) return;
  state.hovered = iso;
  tooltip.innerHTML = tooltipHTML(iso, countries.find(c => isoOf(c.properties) === iso));
  tooltip.classList.remove('hidden');
  tooltip.style.left = e.clientX + 'px'; tooltip.style.top = e.clientY + 'px';
}
const flatView = { x: 0, y: 0, w: FW, h: FH };
let flatDragging = false, flatPanned = false;
function applyFlatView() {
  const svg = document.getElementById('flatViz');
  if (svg) svg.setAttribute('viewBox', flatView.x.toFixed(1) + ' ' + flatView.y.toFixed(1) + ' ' + flatView.w.toFixed(1) + ' ' + flatView.h.toFixed(1));
}
function clampFlatView() {
  flatView.w = Math.max(FW / 40, Math.min(FW, flatView.w));
  flatView.h = flatView.w * (FH / FW);
  flatView.x = Math.max(0, Math.min(FW - flatView.w, flatView.x));
  flatView.y = Math.max(0, Math.min(FH - flatView.h, flatView.y));
}
function resetFlatView() { flatView.x = 0; flatView.y = 0; flatView.w = FW; flatView.h = FH; applyFlatView(); updateFlatMarkers(); }
function flyFlatTo(lon, lat) {
  flatView.w = FW / 8; flatView.h = flatView.w * (FH / FW);
  flatView.x = fpx(lon) - flatView.w / 2; flatView.y = fpy(lat) - flatView.h / 2;
  clampFlatView(); applyFlatView(); updateFlatMarkers();
}
function flatClientToSvg(cx, cy) {
  const svg = document.getElementById('flatViz'), r = svg.getBoundingClientRect();
  const sc = Math.min(r.width / flatView.w, r.height / flatView.h);
  return { x: flatView.x + (cx - r.left - (r.width - flatView.w * sc) / 2) / sc,
           y: flatView.y + (cy - r.top - (r.height - flatView.h * sc) / 2) / sc };
}
let flatBound = false;
function initFlatInteract() {
  if (flatBound) return; flatBound = true;
  const svg = document.getElementById('flatViz');
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const p = flatClientToSvg(e.clientX, e.clientY);
    const k = Math.exp(e.deltaY * 0.0016);
    const nw = flatView.w * k;
    flatView.x = p.x - (p.x - flatView.x) * (nw / flatView.w);
    flatView.y = p.y - (p.y - flatView.y) * (nw / flatView.w);
    flatView.w = nw; clampFlatView(); applyFlatView(); updateFlatMarkers();
  }, { passive: false });
  let sx = 0, sy = 0, ox = 0, oy = 0;
  svg.addEventListener('pointerdown', e => {
    flatDragging = true; flatPanned = false; svg.style.cursor = 'grabbing';
    sx = e.clientX; sy = e.clientY; ox = flatView.x; oy = flatView.y;
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', e => {
    if (!flatDragging) return;
    const r = svg.getBoundingClientRect(), sc = Math.min(r.width / flatView.w, r.height / flatView.h);
    const dx = (e.clientX - sx) / sc, dy = (e.clientY - sy) / sc;
    if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 4) flatPanned = true;
    flatView.x = ox - dx; flatView.y = oy - dy; clampFlatView(); applyFlatView();
  });
  svg.addEventListener('pointerup', e => {
    flatDragging = false; svg.style.cursor = 'grab';
    try { svg.releasePointerCapture(e.pointerId); } catch (err) {}
    setTimeout(() => (flatPanned = false), 30);
  });
}

/* ============================== menu / chrome ============================== */
const menu = document.getElementById('menu'), menuBtn = document.getElementById('menuBtn');
const closeMenu = () => menu.classList.add('hidden');
menuBtn.addEventListener('click', e => { e.stopPropagation(); menu.classList.toggle('hidden'); });
document.addEventListener('click', () => { closeMenu(); document.getElementById('searchResults').classList.add('hidden'); });
menu.addEventListener('click', e => e.stopPropagation());

function setFlat(flat) {
  state.flat = flat;
  /* Reach rings are a globe feature — a flat projection would make a
     geodesic circle look like nonsense near the poles. */
  if (flat && state.reach) { setReach(null); showToast('Missile reach is shown on the globe'); }
  document.getElementById('globeViz').classList.toggle('hidden', flat);
  document.getElementById('flatViz').classList.toggle('hidden', !flat);
  document.getElementById('miView').querySelector('.mi-tx').textContent = flat ? '3D globe' : 'Flat map';
  document.getElementById('miSpin').style.display = flat ? 'none' : '';
  if (flat) {
    if (!flatBuilt) buildFlatMap(); else { updateFlatColors(); updateFlatMarkers(); }
    try { if (!localStorage.getItem('nk_seen_flat')) show('flatTip'); } catch (e) {}
  } else { refreshGlobe(); refreshMarkers(); if (globe) globe.controls().autoRotate = spinOn && !state.playing; }
}
document.getElementById('miView').addEventListener('click', () => { closeMenu(); setFlat(!state.flat); });
const miSpin = document.getElementById('miSpin');
function syncSpin() {
  const s = miSpin.querySelector('.mi-state');
  if (s) s.textContent = spinOn ? 'On' : 'Off';
  miSpin.classList.toggle('on', spinOn);
}
miSpin.addEventListener('click', () => { spinOn = !spinOn; if (globe) globe.controls().autoRotate = spinOn && !state.flat && !state.playing; syncSpin(); });
document.getElementById('miReset').addEventListener('click', () => {
  closeMenu();
  if (state.flat) resetFlatView();
  else if (globe) globe.pointOfView({ lat: 28, lng: 22, altitude: 2.45 }, 800);
});
document.getElementById('miFull').addEventListener('click', () => {
  closeMenu();
  if (!document.fullscreenElement) document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
  else document.exitFullscreen && document.exitFullscreen();
});
document.getElementById('miAbout').addEventListener('click', () => { closeMenu(); show('aboutOverlay'); });
document.getElementById('aboutClose').addEventListener('click', () => hide('aboutOverlay'));
document.getElementById('aboutOverlay').addEventListener('click', e => { if (e.target.id === 'aboutOverlay') hide('aboutOverlay'); });
document.getElementById('miHelp').addEventListener('click', () => { closeMenu(); show('tutorial'); });
document.getElementById('tutStart').addEventListener('click', closeTutorial);
document.getElementById('tutorial').addEventListener('click', e => { if (e.target.id === 'tutorial') closeTutorial(); });
function closeTutorial() {
  const t = document.getElementById('tutorial');
  if (t.classList.contains('hidden')) return;
  t.classList.add('hidden');
  try { localStorage.setItem('nk_seen_tutorial', '1'); } catch (e) {}
}
document.getElementById('ftStart').addEventListener('click', closeFlatTip);
document.getElementById('flatTip').addEventListener('click', e => { if (e.target.id === 'flatTip') closeFlatTip(); });
function closeFlatTip() {
  const t = document.getElementById('flatTip');
  if (t.classList.contains('hidden')) return;
  t.classList.add('hidden');
  try { localStorage.setItem('nk_seen_flat', '1'); } catch (e) {}
}
function closeAll() {
  hide('detailCard'); hide('siteCard'); hide('eventCard');
  state.selected = null; state.selectedSite = null; state.selectedEvent = null;
  setReach(null);
  refreshGlobe(); refreshMarkers(); updateTimelineState(); if (state.flat) syncFlatSelection();
}

function gotoCountry(iso) {
  const f = countries.find(c => isoOf(c.properties) === iso);
  state.selected = iso; state.selectedSite = null; state.selectedEvent = null;
  hide('siteCard'); hide('eventCard');
  refreshGlobe(); refreshMarkers(); showDetail(iso, f);
  if (f) {
    const [lng, lat] = polyCentroid(f);
    if (state.flat) flyFlatTo(lng, lat);
    else if (globe) { globe.controls().autoRotate = false; globe.pointOfView({ lat, lng, altitude: 1.75 }, 800); spinOn = false; syncSpin(); }
  }
  if (state.flat) syncFlatSelection();
}

/* ------------------------------- search ------------------------------- */
const searchEl = document.getElementById('search'), searchRes = document.getElementById('searchResults');
let searchHits = [];
function runSearch() {
  const q = searchEl.value.trim().toLowerCase();
  if (!q) { searchRes.classList.add('hidden'); searchHits = []; return; }
  const hits = [];
  for (const iso in C) {
    const n = nameOf(iso);
    if (n.toLowerCase().includes(q) || iso.toLowerCase() === q) hits.push({ kind: 'country', iso, label: n, sort: n.toLowerCase().indexOf(q) });
  }
  for (const a in ALIASES) {
    if (a.toLowerCase().startsWith(q) && C[ALIASES[a]] && !hits.some(h => h.iso === ALIASES[a]))
      hits.push({ kind: 'country', iso: ALIASES[a], label: nameOf(ALIASES[a]), sort: 0 });
  }
  SITES.forEach(s => {
    if (s.lat == null) return;
    const hay = (s.name + ' ' + (s.aliases || []).join(' ')).toLowerCase();
    const i = hay.indexOf(q);
    if (i >= 0) hits.push({ kind: 'site', id: s.id, iso: s.host, label: s.name, sort: i + 1 });
  });
  searchHits = hits.sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label)).slice(0, 12);
  if (!searchHits.length) { searchRes.innerHTML = '<div class="sr-none">No match</div>'; searchRes.classList.remove('hidden'); return; }
  searchRes.innerHTML = searchHits.map((h, i) =>
    `<div class="sr-item${i === 0 ? ' sel' : ''}" data-i="${i}"><span class="sr-flag">${flagOf(h.iso)}</span>` +
    `<span class="sr-l">${esc(h.label)}</span><span class="sr-kind">${h.kind === 'site' ? 'site' : ''}</span></div>`).join('');
  searchRes.classList.remove('hidden');
}
function pickSearch(i) {
  const h = searchHits[i == null ? 0 : i]; if (!h) return;
  if (h.kind === 'site') selectSite(h.id, true); else gotoCountry(h.iso);
  searchEl.value = ''; searchRes.classList.add('hidden'); searchHits = []; searchEl.blur();
}
searchEl.addEventListener('input', runSearch);
searchEl.addEventListener('click', e => e.stopPropagation());
searchEl.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); pickSearch(0); }
  if (e.key === 'Escape') { searchEl.value = ''; searchRes.classList.add('hidden'); searchEl.blur(); }
});
searchRes.addEventListener('click', e => {
  e.stopPropagation();
  const it = e.target.closest('.sr-item'); if (it) pickSearch(parseInt(it.dataset.i, 10));
});

/* -------------------------------- toast/share -------------------------------- */
let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2400);
}
function buildShareURL() {
  const seg = [state.layer, String(state.year), state.selected || '', state.selectedSite || ''];
  if (state.flat) seg.push('flat');
  while (seg.length > 2 && seg[seg.length - 1] === '') seg.pop();
  return location.origin + location.pathname + '#' + seg.join(',');
}
document.getElementById('miShare').addEventListener('click', () => {
  closeMenu();
  const url = buildShareURL();
  history.replaceState(null, '', '#' + url.split('#')[1]);
  const done = () => showToast('Link copied');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, () => fallbackCopy(url, done));
  else fallbackCopy(url, done);
});
function fallbackCopy(t, cb) {
  const ta = document.createElement('textarea');
  ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); cb(); } catch (e) {}
  document.body.removeChild(ta);
}
function applyHash() {
  const h = decodeURIComponent(location.hash.replace(/^#/, ''));
  if (!h) return;
  const p = h.split(',');
  if (p[0] && LAYERS[p[0]]) setLayer(p[0]);
  if (p[1] && /^\d{4}$/.test(p[1])) { state.year = Math.max(Y0, Math.min(Y1, parseInt(p[1], 10))); applyYear(); }
  if (p.includes('flat')) setFlat(true);
  if (p[2] && C[p[2]]) gotoCountry(p[2]);
  if (p[3] && SITE_BY_ID[p[3]]) selectSite(p[3], true);
}

/* ============================ chart overlays ============================ */
const chartOverlay = document.getElementById('chartOverlay');
document.getElementById('chartClose').addEventListener('click', () => hide('chartOverlay'));
chartOverlay.addEventListener('click', e => { if (e.target.id === 'chartOverlay') hide('chartOverlay'); });
function openChart(title, sub, bodyHTML, legendHTML, cav) {
  document.getElementById('chartTitle').textContent = title;
  document.getElementById('chartSub').textContent = sub || '';
  document.getElementById('chartBody').innerHTML = bodyHTML;
  document.getElementById('chartLegend').innerHTML = legendHTML || '';
  document.getElementById('chartCav').textContent = cav || '';
  show('chartOverlay');
}
function arsenalChartSVG(isoFilter) {
  const W = 820, H = 320, P = { l: 44, r: 12, t: 14, b: 26 };
  const years = []; for (let y = 1945; y <= Y1; y++) years.push(y);
  const list = isoFilter ? [isoFilter] : AREA_ORDER.filter(i => SERIES[i]);
  const max = Math.max(1, ...years.map(y => isoFilter ? (seriesAt(isoFilter, y) || 0) : (globalAt(y).n || 0)));
  const X = y => P.l + (y - 1945) / (Y1 - 1945) * (W - P.l - P.r);
  const Y = v => H - P.b - (v / max) * (H - P.t - P.b);
  let s = `<svg class="wt-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;
  const ticks = max > 40000 ? [0, 20000, 40000, 60000] : max > 8000 ? [0, 5000, 10000, 20000, 30000] : max > 800 ? [0, 1000, 3000, 5000] : [0, 50, 150, 300];
  ticks.filter(t => t <= max).forEach(t => {
    s += `<line x1="${P.l}" y1="${Y(t).toFixed(1)}" x2="${W - P.r}" y2="${Y(t).toFixed(1)}" stroke="rgba(255,255,255,.09)"/>`;
    s += `<text x="${P.l - 6}" y="${(Y(t) + 3).toFixed(1)}" text-anchor="end" fill="#7d8e9c" font-size="9">${fmtCompact(t)}</text>`;
  });
  for (let y = 1950; y <= Y1; y += 10) s += `<text x="${X(y).toFixed(1)}" y="${H - 8}" text-anchor="middle" fill="#7d8e9c" font-size="9">${y}</text>`;
  if (isoFilter) {
    let d = '';
    years.forEach((y, i) => { d += (i ? 'L' : 'M') + X(y).toFixed(1) + ',' + Y(seriesAt(isoFilter, y) || 0).toFixed(1); });
    s += `<path d="${d}L${X(Y1).toFixed(1)},${Y(0)}L${X(1945).toFixed(1)},${Y(0)}Z" fill="${AREA_COLOR[isoFilter] || '#ffd23f'}" opacity=".3"/>`;
    s += `<path d="${d}" fill="none" stroke="${AREA_COLOR[isoFilter] || '#ffd23f'}" stroke-width="2"/>`;
  } else {
    const stacks = years.map(y => { let acc = 0; const o = {}; list.forEach(iso => { const n = seriesAt(iso, y) || 0; o[iso] = [acc, acc + n]; acc += n; }); return o; });
    list.forEach(iso => {
      let up = '', dn = '';
      years.forEach((y, i) => { up += (i ? 'L' : 'M') + X(y).toFixed(1) + ',' + Y(stacks[i][iso][1]).toFixed(1); });
      for (let i = years.length - 1; i >= 0; i--) dn += 'L' + X(years[i]).toFixed(1) + ',' + Y(stacks[i][iso][0]).toFixed(1);
      s += `<path d="${up}${dn}Z" fill="${AREA_COLOR[iso] || '#8c9cab'}" opacity=".82"><title>${esc(nameOf(iso))}</title></path>`;
    });
  }
  // peak marker
  if (!isoFilter) {
    let pk = { y: 0, n: 0 };
    years.forEach(y => { const n = globalAt(y).n || 0; if (n > pk.n) pk = { y, n }; });
    s += `<line x1="${X(pk.y).toFixed(1)}" y1="${P.t}" x2="${X(pk.y).toFixed(1)}" y2="${H - P.b}" stroke="#fff" stroke-dasharray="3 3" opacity=".6"/>`;
    s += `<text x="${(X(pk.y) + 5).toFixed(1)}" y="${P.t + 12}" fill="#fff" font-size="10" font-weight="700">peak ${fmtInt(pk.n)} (${pk.y})</text>`;
  }
  s += '</svg>';
  return s;
}
document.getElementById('miArsenal').addEventListener('click', () => {
  closeMenu();
  const legend = AREA_ORDER.filter(i => SERIES[i]).map(i =>
    `<span class="wt-li"><span class="wt-sw" style="background:${AREA_COLOR[i]}"></span>${esc(nameOf(i))}</span>`).join('');
  let pk = { y: 0, n: 0 };
  for (let y = 1945; y <= Y1; y++) { const n = globalAt(y).n || 0; if (n > pk.n) pk = { y, n }; }
  const now = globalAt(Y1).n;
  openChart('Arsenals over time, 1945–' + Y1,
    `Military stockpiles, stacked. They peaked at about ${fmtInt(pk.n)} warheads in ${pk.y} and stand at roughly ${fmtInt(now)} today` +
      (META.worldInventory ? ` — around ${fmtInt(META.worldInventory)} counting warheads retired but not yet taken apart.` : '.'),
    arsenalChartSVG(null), legend,
    'Estimates from the Bulletin of the Atomic Scientists / Federation of American Scientists nuclear-inventory dataset. Nobody outside the weapons states knows these numbers exactly; recent years in particular are analyst estimates and are revised as new evidence appears.');
});
document.getElementById('detailChart').addEventListener('click', () => {
  const iso = state.selected; if (!iso) return;
  openChart(nameOf(iso) + ' — arsenal over time', 'Total warhead inventory, ' + (SERIES[iso] ? SERIES[iso][0][0] : 1945) + '–' + Y1,
    arsenalChartSVG(iso), '', (C[iso] && C[iso].mt && C[iso].mt.note) || '');
});
document.getElementById('miTests').addEventListener('click', () => {
  closeMenu();
  const rows = TESTC.slice().sort((a, b) => b.tests - a.tests).map(t =>
    `<tr><td>${flagOf(t.iso3)} ${esc(nameOf(t.iso3))}</td><td class="n">${fmtInt(t.tests)}</td><td class="n">${t.atmospheric != null ? fmtInt(t.atmospheric) : '—'}</td><td class="n">${t.totalYieldMt != null ? fmtMt(t.totalYieldMt) : '—'}</td><td>${esc((t.first || '').slice(0, 10))}</td><td>${esc((t.last || '').slice(0, 10))}</td></tr>`).join('');
  const W = window.NUKE_TEST_WORLD || null;
  const total = W && W.tests ? W.tests : TESTC.reduce((a, t) => a + (t.tests || 0), 0);
  const totalYield = W && W.totalYieldMt ? W.totalYieldMt : TESTC.reduce((a, t) => a + (t.totalYieldMt || 0), 0);
  const totalAtmo = W && W.atmospheric ? W.atmospheric : TESTC.reduce((a, t) => a + (t.atmospheric || 0), 0);
  const big = TESTS.slice().sort((a, b) => (b.kt || 0) - (a.kt || 0)).slice(0, 12).map(t =>
    `<tr><td>${flagOf(t.iso3)} ${esc(t.name)}</td><td>${esc(t.date || '')}</td><td>${esc(t.site || '')}</td><td class="n">${t.kt >= 1000 ? fmtMt(t.kt / 1000) + ' Mt' : fmtInt(t.kt) + ' kt'}</td></tr>`).join('');
  openChart('Every nuclear test',
    fmtInt(total) + ' nuclear explosive tests have been carried out since 1945 — ' + fmtInt(totalAtmo) +
    ' of them in the open air, releasing about ' + fmtMt(totalYield) + ' megatons in total.',
    `<table class="ch-table"><thead><tr><th>Country</th><th style="text-align:right">Tests</th><th style="text-align:right">In the air</th><th style="text-align:right">Total yield</th><th>First</th><th>Last</th></tr></thead><tbody>${rows}</tbody></table>` +
    `<div class="sec-cap" style="border:none;margin-top:20px">The largest tests ever</div>` +
    `<table class="ch-table"><thead><tr><th>Test</th><th>Date</th><th>Site</th><th style="text-align:right">Yield</th></tr></thead><tbody>${big}</tbody></table>`,
    '', 'Atmospheric testing was banned for the US, USSR and UK by the Partial Test Ban Treaty of 1963; France tested in the atmosphere until 1974 and China until 1980. Only North Korea has tested this century.');
});
document.getElementById('miClock').addEventListener('click', () => {
  closeMenu();
  const cl = (HUMAN.doomsdayClock || []).slice().reverse();
  const body = cl.length
    ? '<div class="clock-bar" style="margin-bottom:14px"></div>' + cl.map(c =>
        `<div class="clock-row"><span class="clock-y">${c.year}</span><span class="clock-t">${esc(c.time)}</span><span class="clock-r">${esc(c.reason || '')}</span></div>`).join('')
    : '<p class="wt-cav">No clock data loaded.</p>';
  openChart('The Doomsday Clock', 'Set each January by the Bulletin of the Atomic Scientists since 1947 — how close the board judges humanity is to catastrophe.',
    body, '', 'The clock is a judgement, not a measurement. Since 2007 it has also taken account of climate change and disruptive technologies, not only nuclear risk.');
});
document.getElementById('miNotes').addEventListener('click', () => {
  closeMenu();
  const byTopic = {};
  RESEARCH.gaps.forEach(g => (byTopic[g.t || 'general'] = byTopic[g.t || 'general'] || []).push(g.x));
  const TOPIC_NAME = {
    usa: 'United States', russia: 'Russia', china: 'China', france: 'France', uk: 'United Kingdom',
    india: 'India', pakistan: 'Pakistan', dprk: 'North Korea', israel: 'Israel', iran: 'Iran',
    'nato-sharing': 'NATO nuclear sharing', former: 'Former programmes', latent: 'Latent & hedging states',
    tests: 'Nuclear testing', timeseries: 'Arsenals over time', events: 'The historical timeline',
    yields: 'Yields & megatonnage', physics: 'Weapon effects', democracy: 'Governance data',
    delivery: 'Delivery systems', 'fuel-cycle': 'Fissile material', humancost: 'The human record',
    cities: 'City populations', iso: 'Country codes', design: 'Design research', gapfill: 'Gap-filling pass',
  };
  const order = Object.keys(byTopic).sort((a, b) => (TOPIC_NAME[a] || a).localeCompare(TOPIC_NAME[b] || b));
  const body = order.length
    ? order.map(k => `<div class="sec-cap" style="border-top:1px solid var(--line)">${esc(TOPIC_NAME[k] || k)}</div>` +
        byTopic[k].map(x => `<div class="unc-row">${esc(x)}</div>`).join('')).join('')
    : '<p class="wt-cav">No uncertainty notes were recorded for this build.</p>';
  openChart('What we are least sure about',
    'Every dataset like this has soft spots. Rather than hide them, here is what the researchers who assembled it flagged as uncertain, contested or unverifiable — in their own words.',
    body, '',
    'If you can resolve any of these with a published source, please open an issue. Corrections are the whole point.');
});
document.getElementById('miTreaty').addEventListener('click', () => {
  closeMenu();
  const rows = TREATIES.map(t =>
    `<tr><td><b>${esc(t.name)}</b><div style="font-size:11px;color:#8c9cab;margin-top:2px">${esc(t.blurb || '')}</div></td><td class="n">${t.opened || '—'}</td><td class="n">${t.parties != null ? fmtInt(t.parties) : '—'}</td><td style="font-size:11.5px">${esc(t.status2026 || '')}</td></tr>`).join('');
  openChart('Treaties & agreements', 'The legal architecture built to contain the bomb — and where it stands in 2026.',
    `<table class="ch-table"><thead><tr><th>Treaty</th><th style="text-align:right">Opened</th><th style="text-align:right">Parties</th><th>Status in 2026</th></tr></thead><tbody>${rows}</tbody></table>`,
    '', 'New START, the last treaty limiting the US and Russian strategic arsenals, expired on 5 February 2026.');
});

/* ------------------------------ keyboard ------------------------------ */
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'Escape') {
    if (!document.getElementById('simOverlay').classList.contains('hidden')) return; // blast.js handles
    ['aboutOverlay', 'chartOverlay', 'tutorial', 'flatTip'].forEach(hide);
    closeAll(); return;
  }
  if (e.key === 'ArrowLeft') { gotoYear(Math.max(Y0, state.year - 1)); e.preventDefault(); }
  if (e.key === 'ArrowRight') { gotoYear(Math.min(Y1, state.year + 1)); e.preventDefault(); }
  if (e.key === ' ') { (state.playing ? stopPlay() : startPlay(1)); e.preventDefault(); }
  if (e.key === '/') { searchEl.focus(); e.preventDefault(); }
  if (e.key === 'f' || e.key === 'F') setFlat(!state.flat);
});

/* Hide menu entries whose dataset did not make it into this build, rather
   than opening an empty panel. */
function pruneMenu() {
  const gone = [];
  const check = [
    ['miTests', TESTC.length || TESTS.length],
    ['miTreaty', TREATIES.length],
    ['miClock', (HUMAN.doomsdayClock || []).length],
    ['miNotes', RESEARCH.gaps.length],
    ['miArsenal', Object.keys(SERIES).length],
  ];
  check.forEach(([id, ok]) => {
    const el = document.getElementById(id);
    if (el && !ok) { el.style.display = 'none'; gone.push(id); }
  });
  return gone;
}

/* -------------------------------- boot -------------------------------- */
function boot() {
  fetch('data/countries.geojson')
    .then(r => r.json())
    .then(geo => {
      window.NUKE_GEO = geo;
      initGlobe(geo);
      buildToggles(); buildTimeline(); setLayer('status'); applyYear(); pruneMenu();
      applyHash();
      try { if (!localStorage.getItem('nk_seen_tutorial')) show('tutorial'); } catch (e) { show('tutorial'); }
      syncSpin();
      if (window.NukeBlast && window.NukeBlast.init) window.NukeBlast.init();
    })
    .catch(err => {
      console.error(err);
      document.getElementById('globeViz').innerHTML =
        '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#8c9cab;padding:30px;text-align:center">Could not load the map data. If you opened this file directly, run it from a local web server instead.</div>';
    });
}
window.NukeApp = {
  get state() { return state; }, C, SITES, CITIES, WTYPES, SERIES, seriesAt, mtAt, nameOf, flagOf, possessive, theName,
  gotoCountry, selectSite, showToast, fmtInt, fmtMt, esc, Y1,
};
boot();
