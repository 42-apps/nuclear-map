/* ============================================================================
   blast.js — the detonation simulator.

   Two modes:
     "single"  — one warhead on one place, drawn to scale on a local map.
     "arsenal" — a whole country's stockpile spread over the world's largest
                 cities, to show what an arsenal actually means.

   All effect radii come from physics.js. Nothing here is a targeting tool:
   the point is that the numbers are enormous and the map is the only honest
   way to feel that.
   ========================================================================== */
'use strict';

(function () {
  const P = window.NukePhysics;
  const A = () => window.NukeApp;
  const KM_PER_DEG_LAT = 110.57;
  const KM_PER_DEG_LON = 111.32;
  const PERSISTENT_EFFECTS_KEY = 'nuke_simulator_effects_v1';
  // The public OSM standard tile endpoint currently publishes native tiles up to z19.
  // Below this span we keep zooming the z19 source pixels client-side instead of
  // requesting unsupported z20+ URLs.
  const OSM_MAX_ZOOM = 19;
  const MIN_VIEW_SPAN_KM = 0.08;

  const el = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nf = new Intl.NumberFormat('en-US');
  const fmtInt = n => (n == null ? '—' : nf.format(Math.round(n)));
  function fmtBig(n) {
    if (n == null) return '—';
    if (n >= 1e9) return (n / 1e9).toFixed(1) + ' bn';
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + ' M';
    if (n >= 1e3) return Math.round(n / 1e3) + 'k';
    return fmtInt(n);
  }
  function fmtKt(kt) {
    if (kt >= 1000) return (kt / 1000 >= 10 ? Math.round(kt / 1000) : (kt / 1000).toFixed(1)) + ' Mt';
    if (kt >= 1) return Math.round(kt) + ' kt';
    return kt.toFixed(2) + ' kt';
  }
  function fmtKm(km) {
    if (km >= 100) return Math.round(km) + ' km';
    if (km >= 10) return km.toFixed(1) + ' km';
    if (km >= 1) return km.toFixed(2) + ' km';
    return Math.round(km * 1000) + ' m';
  }
  const BEARING_NAMES = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const bearingName = b => BEARING_NAMES[Math.round(((b % 360) + 360) % 360 / 45) % 8];

  function loadPersistentDetonations() {
    try {
      const value = JSON.parse(localStorage.getItem(PERSISTENT_EFFECTS_KEY) || '[]');
      return Array.isArray(value) ? value.filter(d => d && Number.isFinite(d.lat) && Number.isFinite(d.lon) && Array.isArray(d.rings)) : [];
    } catch (error) {
      return [];
    }
  }

  function storePersistentDetonations(items) {
    try {
      if (items.length) localStorage.setItem(PERSISTENT_EFFECTS_KEY, JSON.stringify(items));
      else localStorage.removeItem(PERSISTENT_EFFECTS_KEY);
    } catch (error) { /* Persistence is optional when browser storage is unavailable. */ }
  }

  /* ------------------------------------------------------------------ state */
  const S = {
    mode: 'single',
    yieldKt: 300,
    weaponKey: null,
    burst: 'air',
    fallout: false,
    advanced: false,
    compare: false,
    windBearing: 90,
    windMph: 15,
    hobM: null,          // null = the model's default optimised airburst height
    target: null,          // {n, lat, lon, pop, dens, iso3}
    arsenalIso: 'USA',
    basemap: 'dark',
    view: { spanKm: 60, centerLat: null, centerLon: null }, // half-width in km; viewport center is separate from ground zero
    open: false,
    lastEffects: null,
    detonationPhase: 'idle',
    detonationTimer: null,
    detonationToken: 0,
    persistentDetonations: loadPersistentDetonations(),
    effectsCleared: false,
  };

  /* ------------------------------------------------------------- weapon list */
  function weaponPresets() {
    const out = [];
    out.push({ group: 'Historic', items: [
      { key: 'littleboy', name: 'Hiroshima — "Little Boy"', kt: 15, note: 'Gun-type uranium bomb, airburst at 580 m, 6 August 1945.' },
      { key: 'fatman', name: 'Nagasaki — "Fat Man"', kt: 21, note: 'Implosion plutonium bomb, airburst at 503 m, 9 August 1945.' },
      { key: 'bravo', name: 'Castle Bravo (largest US test)', kt: 15000, note: 'March 1954, Bikini Atoll — two and a half times the predicted yield, contaminating inhabited atolls.' },
      { key: 'tsar', name: 'Tsar Bomba (largest ever)', kt: 50000, note: '30 October 1961, Novaya Zemlya. Deliberately halved from a 100 Mt design; the fireball alone was ~8 km across.' },
    ] });
    const byCountry = {};
    (A().WTYPES || []).forEach(w => {
      if (!w.kt || w.status === 'retired') return;
      (byCountry[w.iso3] = byCountry[w.iso3] || []).push(w);
    });
    Object.keys(byCountry).sort((a, b) => (A().nameOf(a)).localeCompare(A().nameOf(b))).forEach(iso => {
      const items = byCountry[iso]
        .sort((a, b) => b.kt - a.kt)
        .filter((w, i, arr) => arr.findIndex(x => x.name === w.name) === i)
        .slice(0, 12)
        .map(w => ({ key: iso + ':' + w.name, name: w.name + ' — ' + fmtKt(w.kt), kt: w.kt,
                     note: [w.platform, w.note].filter(Boolean).join(' · ') }));
      if (items.length) out.push({ group: A().flagOf(iso) + ' ' + A().nameOf(iso), items });
    });
    out.push({ group: 'Other', items: [{ key: 'custom', name: 'Custom yield…', kt: null, note: 'Set any yield with the slider.' }] });
    return out;
  }
  let PRESETS = [];
  const presetByKey = k => { for (const g of PRESETS) { const i = g.items.find(x => x.key === k); if (i) return i; } return null; };

  /* --------------------------------------------------------------- yield <-> slider */
  const KT_MIN = 0.05, KT_MAX = 100000;
  const sliderToKt = v => KT_MIN * Math.pow(KT_MAX / KT_MIN, v / 1000);
  const ktToSlider = kt => Math.round(1000 * Math.log(kt / KT_MIN) / Math.log(KT_MAX / KT_MIN));

  /* ------------------------------------------------------------------- build */
  let built = false;
  function buildLists() {
    PRESETS = weaponPresets();
    const wsel = el('simWeapon');
    wsel.innerHTML = PRESETS.map(g =>
      `<optgroup label="${esc(g.group)}">` + g.items.map(i => `<option value="${esc(i.key)}">${esc(i.name)}</option>`).join('') + '</optgroup>').join('');

    // targets — cities, biggest first, plus nuclear-relevant places
    const cities = (A().CITIES || []).slice().sort((a, b) => (b.pop || 0) - (a.pop || 0));
    const tsel = el('simTarget');
    const opt = (c, i, withPop) => `<option value="c${i}">${esc(c.name)}, ${esc(c.country || c.iso3 || '')}${withPop ? ' — ' + fmtBig(c.pop) : ''}</option>`;
    tsel.innerHTML = '<option value="">— pick a city or click the map —</option>' +
      '<optgroup label="Largest cities">' + cities.slice(0, 120).map((c, i) => opt(c, i, true)).join('') + '</optgroup>' +
      '<optgroup label="Everywhere else">' + cities.slice(120).map((c, i) => opt(c, i + 120, false)).join('') + '</optgroup>';
    S._cities = cities;

    // arsenals
    const armed = Object.keys(A().C).filter(iso => (A().seriesAt(iso, A().Y1) || 0) > 0)
      .sort((a, b) => (A().seriesAt(b, A().Y1) || 0) - (A().seriesAt(a, A().Y1) || 0));
    el('simArsenal').innerHTML = armed.map(iso =>
      `<option value="${iso}">${A().flagOf(iso)} ${esc(A().nameOf(iso))} — ${fmtInt(A().seriesAt(iso, A().Y1))} warheads</option>`).join('');
  }
  function build() {
    if (built) return; built = true;
    buildLists();
    const wsel = el('simWeapon');

    // default weapon
    const w300 = presetByKey('USA:W87-0') || presetByKey('littleboy');
    S.weaponKey = w300 ? w300.key : 'littleboy';
    wsel.value = S.weaponKey;
    S.yieldKt = w300 ? w300.kt : 15;
    el('simYield').value = ktToSlider(S.yieldKt);

    /* events */
    wsel.addEventListener('change', () => {
      S.weaponKey = wsel.value;
      const p = presetByKey(S.weaponKey);
      if (p && p.kt) { S.yieldKt = p.kt; el('simYield').value = ktToSlider(p.kt); }
      render();
    });
    el('simYield').addEventListener('input', () => {
      S.yieldKt = roundNice(sliderToKt(parseInt(el('simYield').value, 10)));
      const p = presetByKey(S.weaponKey);
      if (!p || p.kt !== S.yieldKt) { S.weaponKey = 'custom'; el('simWeapon').value = 'custom'; }
      render();
    });
    el('simMode').addEventListener('click', e => {
      const b = e.target.closest('.seg-b'); if (!b) return;
      resetDetonation();
      S.mode = b.dataset.mode;
      el('simMode').querySelectorAll('.seg-b').forEach(x => x.classList.toggle('on', x === b));
      el('simWeaponGroup').style.display = S.mode === 'single' ? '' : 'none';
      el('simArsenalGroup').style.display = S.mode === 'arsenal' ? '' : 'none';
      render();
    });
    el('simBurst').addEventListener('click', e => {
      const b = e.target.closest('.seg-b'); if (!b) return;
      S.burst = b.dataset.burst;
      el('simBurst').querySelectorAll('.seg-b').forEach(x => x.classList.toggle('on', x === b));
      S.hobM = null;                                   // back to the model default
      if (S.burst === 'air' && S.fallout) { S.fallout = false; el('simFallout').checked = false; }
      render();
    });
    el('simTarget').addEventListener('change', () => {
      const v = el('simTarget').value;
      if (!v) return;
      const c = S._cities[parseInt(v.slice(1), 10)];
      if (c) {
        S.target = c;
        setViewCenter(c.lat, c.lon);
        fitToEffects();
        render();
      }
    });
    el('simArsenal').addEventListener('change', () => { S.arsenalIso = el('simArsenal').value; render(); });
    el('simBasemap').addEventListener('click', e => {
      const b = e.target.closest('.seg-b'); if (!b) return;
      S.basemap = b.dataset.basemap;
      el('simBasemap').querySelectorAll('.seg-b').forEach(x => x.classList.toggle('on', x === b));
      render();
    });
    el('simFallout').addEventListener('change', () => {
      S.fallout = el('simFallout').checked;
      if (S.fallout && S.burst === 'air') {
        S.burst = 'surface';
        el('simBurst').querySelectorAll('.seg-b').forEach(x => x.classList.toggle('on', x.dataset.burst === 'surface'));
        A().showToast('Fallout needs a surface burst — switched.');
      }
      render();
    });
    el('simAdvanced').addEventListener('change', () => { S.advanced = el('simAdvanced').checked; render(); });
    el('simCompare').addEventListener('change', () => { S.compare = el('simCompare').checked; render(); });
    el('simWind').addEventListener('input', () => { S.windBearing = parseInt(el('simWind').value, 10); render(); });
    el('simWindSpeed').addEventListener('input', () => {
      S.windMph = parseInt(el('simWindSpeed').value, 10); render();
    });
    el('simHob').addEventListener('input', () => {
      const v = parseInt(el('simHob').value, 10);
      S.hobM = v <= 0 ? 0 : Math.round(v / 100 * P.optimumHob(S.yieldKt, 1) * 1.15);
      if (S.hobM === 0 && S.burst !== 'surface') {
        S.burst = 'surface';
        el('simBurst').querySelectorAll('.seg-b').forEach(x => x.classList.toggle('on', x.dataset.burst === 'surface'));
      } else if (S.hobM > 0 && S.burst === 'surface') {
        S.burst = 'air';
        el('simBurst').querySelectorAll('.seg-b').forEach(x => x.classList.toggle('on', x.dataset.burst === 'air'));
      }
      render();
    });
    el('simZoomIn').addEventListener('click', () => { S.view.spanKm = Math.max(MIN_VIEW_SPAN_KM, S.view.spanKm / 1.6); render(); });
    el('simZoomOut').addEventListener('click', () => { S.view.spanKm = Math.min(20000, S.view.spanKm * 1.6); render(); });
    el('simFit').addEventListener('click', () => { fitToEffects(); render(); });
    el('simDetonate').addEventListener('click', triggerDetonation);
    el('simClearEffects').addEventListener('click', clearMapEffects);
    el('simClose').addEventListener('click', close);
    el('simOverlay').addEventListener('click', e => { if (e.target.id === 'simOverlay') close(); });
    document.addEventListener('keydown', e => {
      if (!S.open) return;
      if (e.key === 'Escape') { close(); e.preventDefault(); }
      if (e.key === '+' || e.key === '=') { S.view.spanKm = Math.max(MIN_VIEW_SPAN_KM, S.view.spanKm / 1.6); render(); }
      if (e.key === '-') { S.view.spanKm *= 1.6; render(); }
    });

    const svg = el('simMap');
    svg.addEventListener('click', e => {
      if (S.mode !== 'single' || S._dragMoved) { S._dragMoved = false; return; }
      const p = svgToLatLon(e);
      if (!p) return;
      S.target = nearestCityOrPoint(p[0], p[1]);
      setViewCenter(S.target.lat, S.target.lon);
      render();
    });
    let drag = null;
    svg.addEventListener('pointerdown', e => {
      if (S.mode !== 'single' || e.button !== 0) return;
      const c = viewCenter();
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, lat: c.lat, lon: c.lon, moved: false };
      svg.setPointerCapture(e.pointerId);
      svg.classList.add('dragging');
    });
    svg.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      const cosLat = Math.max(0.12, Math.cos(drag.lat * Math.PI / 180));
      setViewCenter(
        drag.lat + dy * VB.kmPerPx / KM_PER_DEG_LAT,
        drag.lon - dx * VB.kmPerPx / (KM_PER_DEG_LON * cosLat),
      );
      S._dragMoved = drag.moved;
      render();
    });
    const endDrag = e => {
      if (!drag || e.pointerId !== drag.id) return;
      S._dragMoved = drag.moved;
      drag = null;
      svg.classList.remove('dragging');
    };
    svg.addEventListener('pointerup', endDrag);
    svg.addEventListener('pointercancel', endDrag);
    svg.addEventListener('wheel', e => {
      e.preventDefault();
      S.view.spanKm = Math.max(MIN_VIEW_SPAN_KM, Math.min(20000, S.view.spanKm * Math.exp(e.deltaY * 0.0014)));
      render();
    }, { passive: false });
  }
  function roundNice(kt) {
    if (kt >= 1000) return Math.round(kt / 50) * 50;
    if (kt >= 100) return Math.round(kt / 5) * 5;
    if (kt >= 10) return Math.round(kt);
    if (kt >= 1) return Math.round(kt * 10) / 10;
    return Math.round(kt * 100) / 100;
  }
  function nearestCityOrPoint(lat, lon) {
    let best = null, bd = Infinity;
    for (const c of (A().CITIES || [])) {
      const d = P.haversine(lat, lon, c.lat, c.lon);
      if (d < bd) { bd = d; best = c; }
    }
    if (best && bd < Math.max(12, best.pop ? Math.sqrt(best.pop / (Math.PI * (best.dens || 3000))) : 10)) {
      return Object.assign({}, best, { lat, lon, offsetKm: bd, name: best.name + (bd > 2 ? ' (nearby)' : '') });
    }
    return { name: lat.toFixed(3) + '°, ' + lon.toFixed(3) + '°', lat, lon,
             pop: best && bd < 40 ? Math.round(best.pop * 0.25) : 0,
             dens: best && bd < 40 ? Math.round((best.dens || 2000) * 0.3) : P.RURAL_DENSITY,
             iso3: best ? best.iso3 : null, adhoc: true };
  }

  /* --------------------------------------------------------------- projection */
  /* Local equirectangular kilometres, centred on the current map viewport. */
  let VB = { w: 1000, h: 700, cx: 500, cy: 350, kmPerPx: 1 };
  function measure() {
    const r = el('simMap').getBoundingClientRect();
    VB.w = Math.max(320, r.width || 900); VB.h = Math.max(240, r.height || 640);
    VB.cx = VB.w / 2; VB.cy = VB.h / 2;
    VB.kmPerPx = (S.view.spanKm * 2) / Math.min(VB.w, VB.h);
  }
  function project(lat, lon) {
    const t = viewCenter();
    let dlon = lon - t.lon;
    while (dlon > 180) dlon -= 360;
    while (dlon < -180) dlon += 360;
    const x = dlon * KM_PER_DEG_LON * Math.cos(t.lat * Math.PI / 180);
    const y = (lat - t.lat) * KM_PER_DEG_LAT;
    return [VB.cx + x / VB.kmPerPx, VB.cy - y / VB.kmPerPx];
  }
  function svgToLatLon(evt) {
    const svg = el('simMap'), r = svg.getBoundingClientRect();
    const px = evt.clientX - r.left, py = evt.clientY - r.top;
    const t = viewCenter();
    const xKm = (px - VB.cx) * VB.kmPerPx, yKm = (VB.cy - py) * VB.kmPerPx;
    const lat = t.lat + yKm / KM_PER_DEG_LAT;
    const lon = t.lon + xKm / (KM_PER_DEG_LON * Math.cos(t.lat * Math.PI / 180) || 1);
    return [Math.max(-85, Math.min(85, lat)), ((lon + 540) % 360) - 180];
  }
  const kmToPx = km => km / VB.kmPerPx;
  function viewCenter() {
    return {
      lat: S.view.centerLat == null ? (S.target ? S.target.lat : 0) : S.view.centerLat,
      lon: S.view.centerLon == null ? (S.target ? S.target.lon : 0) : S.view.centerLon,
    };
  }
  function setViewCenter(lat, lon) {
    S.view.centerLat = Math.max(-85, Math.min(85, lat));
    S.view.centerLon = ((lon + 540) % 360) - 180;
  }

  /* OSM is a visual reference layer. Its Web Mercator tiles are positioned
     from the viewport center and scaled from the same physical km-per-pixel value used
     by the effect rings, so the radius labels never inherit tile units. */
  function osmY(lat) {
    const r = lat * Math.PI / 180;
    return Math.log(Math.tan(Math.PI / 4 + r / 2));
  }
  function updateOsmTiles() {
    const box = el('simOsmTiles'), attribution = el('simOsmAttribution');
    if (!box || !attribution) return;
    const on = S.basemap === 'osm';
    box.classList.toggle('on', on); attribution.classList.toggle('on', on);
    if (!on || !S.target) { box.replaceChildren(); return; }
    const center = viewCenter();
    const lat = Math.max(-85, Math.min(85, center.lat));
    const lon = center.lon;
    const cosLat = Math.max(0.12, Math.cos(lat * Math.PI / 180));
    const circumferenceKm = 40075.016;
    // One Web-Mercator world pixel is cos(latitude) times smaller on the
    // ground than at the equator. Convert physical km-per-pixel explicitly.
    const wantedWorldPx = circumferenceKm * cosLat / VB.kmPerPx;
    const zoom = Math.min(OSM_MAX_ZOOM, Math.max(0, Math.round(Math.log2(wantedWorldPx / 256))));
    const world = 256 * Math.pow(2, zoom);
    const cx = (lon + 180) / 360 * world;
    const cy = (1 - osmY(lat) / Math.PI) / 2 * world;
    const scale = circumferenceKm * cosLat / (world * VB.kmPerPx);
    const left = VB.w / 2 - cx * scale;
    const top = VB.h / 2 - cy * scale;
    const tileSize = 256 * scale;
    const minX = Math.floor(-left / tileSize);
    const maxX = Math.floor((VB.w - left) / tileSize);
    const minY = Math.floor(-top / tileSize);
    const maxY = Math.floor((VB.h - top) / tileSize);
    const existing = new Map(Array.from(box.querySelectorAll('img')).map(image => [image.dataset.key, image]));
    const frag = document.createDocumentFragment();
    for (let tx = minX; tx <= maxX; tx++) {
      const wrappedX = ((tx % Math.pow(2, zoom)) + Math.pow(2, zoom)) % Math.pow(2, zoom);
      for (let ty = minY; ty <= maxY; ty++) {
        if (ty < 0 || ty >= Math.pow(2, zoom)) continue;
        const key = `${zoom}/${wrappedX}/${ty}`;
        let image = existing.get(key);
        if (image) existing.delete(key);
        else {
          image = document.createElement('img');
          image.alt = '';
          image.loading = 'eager';
          image.decoding = 'async';
          image.dataset.key = key;
          image.dataset.zoom = String(zoom);
          image.src = `https://tile.openstreetmap.org/${key}.png`;
        }
        image.style.left = `${left + tx * 256 * scale}px`;
        image.style.top = `${top + ty * 256 * scale}px`;
        // A fractional CSS pixel of overlap prevents seams at non-integer scales.
        image.style.width = `${tileSize + 0.5}px`;
        image.style.height = `${tileSize + 0.5}px`;
        frag.appendChild(image);
      }
    }
    box.replaceChildren(frag);
  }

  function fitToEffects() {
    const e = P.effects(S.yieldKt, S.burst, { windMph: S.windMph, hobM: S.burst === 'surface' ? 0 : S.hobM });
    let span = e.maxKm * 1.35;
    if (S.fallout && e.fallout && e.fallout.length) span = Math.max(span, e.fallout[e.fallout.length - 1].downwindKm * 0.62);
    S.view.spanKm = Math.max(MIN_VIEW_SPAN_KM, span);
  }

  /* ----------------------------------------------------------------- land */
  let LAND_CACHE = null;
  function landPaths() {
    if (LAND_CACHE) return LAND_CACHE;
    const geo = window.NUKE_GEO;
    if (!geo) return [];
    LAND_CACHE = [];
    geo.features.forEach(f => {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      polys.forEach(poly => poly.forEach((ring, ri) => { if (ri === 0) LAND_CACHE.push(ring); }));
    });
    return LAND_CACHE;
  }
  function drawLand() {
    const rings = landPaths();
    if (!rings.length) return '';
    const t = viewCenter();
    const spanLat = (S.view.spanKm / KM_PER_DEG_LAT) * 1.6;
    const spanLon = (S.view.spanKm / (KM_PER_DEG_LON * Math.cos(t.lat * Math.PI / 180) || 1)) * 1.6;
    let d = '';
    for (const ring of rings) {
      // cheap bbox reject
      let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
      for (const p of ring) { if (p[0] < mnx) mnx = p[0]; if (p[0] > mxx) mxx = p[0]; if (p[1] < mny) mny = p[1]; if (p[1] > mxy) mxy = p[1]; }
      if (mxy < t.lat - spanLat || mny > t.lat + spanLat) continue;
      if (mxx < t.lon - spanLon && mxx < t.lon - spanLon + 360) { if (mxx < t.lon - spanLon) continue; }
      if (mnx > t.lon + spanLon) continue;
      const step = S.view.spanKm < 1500 ? 1 : ring.length > 4000 ? 3 : ring.length > 1200 ? 2 : 1;
      let s = '';
      for (let i = 0; i < ring.length; i += step) {
        const p = project(ring[i][1], ring[i][0]);
        s += (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1);
      }
      d += s + 'Z';
    }
    return `<path class="sim-land" d="${d}"/>`;
  }

  /* ------------------------------------------------------------- rendering */
  function render() {
    if (!S.open) return;
    measure();
    if (S.mode === 'arsenal') return renderArsenal();
    renderSingle();
  }

  function resetDetonation() {
    if (S.detonationTimer) clearTimeout(S.detonationTimer);
    S.detonationTimer = null;
    S.detonationToken++;
    S.detonationPhase = 'idle';
    updateDetonationControl();
  }

  function updateDetonationControl() {
    const wrap = el('simDetonationControl'), button = el('simDetonate');
    if (!wrap || !button) return;
    wrap.hidden = S.mode !== 'single';
    const active = S.detonationPhase === 'animating';
    const replay = S.detonationPhase === 'settled';
    button.disabled = active;
    button.classList.toggle('is-active', active);
    button.classList.toggle('is-settled', replay);
    button.querySelector('.sim-detonate-label').textContent = replay ? 'Replay detonation' : 'Simulate detonation';
    el('simDetonateStatus').textContent = active ? 'Detonating...' : 'Ready';
    const clear = el('simClearEffects');
    clear.hidden = S.persistentDetonations.length === 0;
    clear.disabled = active;
  }

  function detonationSignature(target, yieldKt, burst, fallout, windBearing) {
    return [target.lat.toFixed(5), target.lon.toFixed(5), yieldKt, burst, fallout ? windBearing : 'none'].join('|');
  }

  function savePersistentDetonation() {
    const eff = P.effects(S.yieldKt, S.burst, { windMph: S.windMph, hobM: S.burst === 'surface' ? 0 : S.hobM });
    const snapshot = {
      signature: detonationSignature(S.target, S.yieldKt, S.burst, S.fallout, S.windBearing),
      lat: S.target.lat,
      lon: S.target.lon,
      yieldKt: S.yieldKt,
      burst: S.burst,
      windBearing: S.windBearing,
      rings: eff.rings.filter(r => S.advanced || !r.adv).map(r => Object.assign({}, r)),
      crater: eff.crater ? Object.assign({}, eff.crater) : null,
      fallout: S.fallout && eff.fallout ? eff.fallout.map(f => Object.assign({}, f)) : null,
    };
    const i = S.persistentDetonations.findIndex(d => d.signature === snapshot.signature);
    if (i >= 0) S.persistentDetonations[i] = snapshot;
    else S.persistentDetonations.push(snapshot);
    storePersistentDetonations(S.persistentDetonations);
  }

  function clearMapEffects() {
    if (S.detonationPhase === 'animating') return;
    S.persistentDetonations.length = 0;
    storePersistentDetonations(S.persistentDetonations);
    S.effectsCleared = true;
    S.detonationPhase = 'idle';
    render();
  }

  function triggerDetonation() {
    if (S.mode !== 'single' || S.detonationPhase === 'animating') return;
    if (!S.target) S.target = defaultTarget();
    if (S.detonationTimer) clearTimeout(S.detonationTimer);
    const token = ++S.detonationToken;
    S.effectsCleared = false;
    savePersistentDetonation();
    S.detonationPhase = 'animating';
    render();
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    S.detonationTimer = setTimeout(() => {
      if (token !== S.detonationToken) return;
      S.detonationTimer = null;
      S.detonationPhase = 'settled';
      render();
    }, reduced ? 650 : 2800);
  }

  function renderSingle() {
    if (!S.target) S.target = defaultTarget();
    if (S.view.centerLat == null || S.view.centerLon == null) setViewCenter(S.target.lat, S.target.lon);
    syncTargetSelect();
    const eff = P.effects(S.yieldKt, S.burst, { windMph: S.windMph, hobM: S.burst === 'surface' ? 0 : S.hobM });
    S.lastEffects = eff;
    const cas = P.casualties(eff, S.target);

    /* ---- map ---- */
    const svg = el('simMap');
    svg.setAttribute('viewBox', `0 0 ${VB.w} ${VB.h}`);
    const origin = project(S.target.lat, S.target.lon);
    let s = S.basemap === 'osm' ? '' : `<rect x="0" y="0" width="${VB.w}" height="${VB.h}" fill="#060a0f"/>`;
    s += S.basemap === 'osm' ? '' : drawLand();
    s += `<defs>` +
      `<radialGradient id="simFireballGradient"><stop offset="0" stop-color="#fff"/><stop offset=".2" stop-color="#fffbd0"/><stop offset=".52" stop-color="#ffcf43"/><stop offset=".78" stop-color="#ff641f"/><stop offset="1" stop-color="#7c1209" stop-opacity="0"/></radialGradient>` +
      `<radialGradient id="simCraterGradient"><stop offset="0" stop-color="#080909"/><stop offset=".64" stop-color="#1a1713"/><stop offset=".82" stop-color="#5e4a35"/><stop offset="1" stop-color="#d6b379" stop-opacity=".18"/></radialGradient>` +
      `<filter id="simHotBlur" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="5"/></filter>` +
      `</defs>`;

    // distance grid
    const gridStep = niceStep(S.view.spanKm / 2.2);
    for (let k = gridStep; k <= S.view.spanKm * 1.5; k += gridStep) {
      const r = kmToPx(k);
      if (r < 16) continue;
      s += `<circle class="sim-gridline" cx="${origin[0].toFixed(1)}" cy="${origin[1].toFixed(1)}" r="${r.toFixed(1)}"/>`;
      const ly = origin[1] - r - 4;
      if (ly > 12 && ly < VB.h - 8) s += `<text class="sim-city" x="${origin[0].toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" opacity=".55">${fmtKm(k)}</text>`;
    }

    // nearby cities
    const near = (A().CITIES || []).map(c => ({ c, d: P.haversine(S.target.lat, S.target.lon, c.lat, c.lon) }))
      .filter(x => x.d < S.view.spanKm * 1.5).sort((a, b) => a.d - b.d).slice(0, 26);
    near.forEach(({ c }) => {
      const p = project(c.lat, c.lon);
      if (p[0] < -40 || p[0] > VB.w + 40 || p[1] < -40 || p[1] > VB.h + 40) return;
      s += `<circle class="sim-cityd" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2"/>`;
      s += `<text class="sim-city" x="${(p[0] + 5).toFixed(1)}" y="${(p[1] + 3).toFixed(1)}">${esc(c.name)}</text>`;
    });

    // Completed detonations stay tied to their original coordinates. The
    // matching live preview is skipped to avoid drawing the same event twice.
    const currentSignature = detonationSignature(S.target, S.yieldKt, S.burst, S.fallout, S.windBearing);
    S.persistentDetonations.forEach(d => {
      if (d.signature === currentSignature && !S.effectsCleared) return;
      const savedOrigin = project(d.lat, d.lon);
      s += `<g class="sim-persistent-effect">`;
      if (d.fallout) d.fallout.slice().reverse().forEach((f, i) => {
        s += falloutPath(f, savedOrigin, 0.07 + i * 0.045, d.windBearing, 'sim-persistent-fallout');
      });
      d.rings.forEach(r => {
        const px = kmToPx(r.km);
        if (px < 0.6) return;
        s += `<circle class="sim-persistent-ring" cx="${savedOrigin[0].toFixed(1)}" cy="${savedOrigin[1].toFixed(1)}" r="${px.toFixed(2)}" fill="${r.color}" fill-opacity="${Math.min(.08, r.fill == null ? .07 : r.fill * .62)}" stroke="${r.color}" stroke-width="1.4" stroke-opacity=".72"${r.dash ? ` stroke-dasharray="${r.dash}"` : ''}/>`;
      });
      if (d.burst === 'surface' && d.crater) s += craterMarkup(savedOrigin, d.crater, 'sim-persistent-crater');
      s += `</g>`;
    });

    // fallout first (underneath the rings)
    if (!S.effectsCleared && S.fallout && eff.fallout) {
      eff.fallout.slice().reverse().forEach((f, i) => {
        s += falloutPath(f, origin, 0.09 + i * 0.06);
      });
    }

    // A crater is only physically meaningful for a surface burst. Its map size
    // uses the same kilometre-to-pixel conversion as every other effect layer.
    if (!S.effectsCleared && S.burst === 'surface' && eff.crater) {
      const craterAnim = S.detonationPhase === 'animating' ? ' detonating' : '';
      s += craterMarkup(origin, eff.crater, craterAnim.trim());
    }

    // effect rings, largest first
    const rings = eff.rings.filter(r => S.advanced || !r.adv);
    const ringOrder = rings.slice().sort((a, b) => a.km - b.km);
    if (!S.effectsCleared) rings.forEach(r => {
      const px = kmToPx(r.km);
      if (px < 0.6) return;
      const dim = r.key === 'rem500' && eff.radiationIrrelevant;
      const delay = 320 + ringOrder.indexOf(r) * 170;
      const anim = S.detonationPhase === 'animating' ? ' sim-effect-ring detonating' : ' sim-effect-ring';
      s += `<circle class="${anim.trim()}" style="--ring-delay:${delay}ms;transform-origin:${origin[0].toFixed(1)}px ${origin[1].toFixed(1)}px" cx="${origin[0].toFixed(1)}" cy="${origin[1].toFixed(1)}" r="${px.toFixed(2)}" fill="${r.color}"` +
        ` fill-opacity="${dim ? 0.04 : (r.fill == null ? 0.10 : r.fill)}" stroke="${r.color}"` +
        ` stroke-width="${r.key === 'psi20' ? 2.4 : 1.8}" stroke-opacity="${dim ? 0.35 : 0.95}"` +
        (r.dash ? ` stroke-dasharray="${r.dash}"` : '') + '/>';
    });
    if (S.detonationPhase === 'animating') {
      const fireball = rings.find(r => r.key === 'fireball');
      const fireballPx = Math.max(5, fireball ? kmToPx(fireball.km) : 8);
      const shockPx = Math.min(Math.hypot(VB.w, VB.h) * 0.72, Math.max.apply(null, rings.map(r => kmToPx(r.km))));
      const debris = Array.from({ length: 22 }, (_, i) => {
        const a = i * 2.39996;
        const spread = Math.min(shockPx * (0.23 + (i % 5) * 0.045), 160);
        const dx = Math.cos(a) * spread, dy = Math.sin(a) * spread;
        const radius = 1.1 + (i % 4) * 0.55;
        return `<circle class="sim-debris" style="--dx:${dx.toFixed(1)}px;--dy:${dy.toFixed(1)}px;--debris-delay:${(90 + (i % 7) * 34)}ms" cx="${origin[0].toFixed(1)}" cy="${origin[1].toFixed(1)}" r="${radius.toFixed(1)}"/>`;
      }).join('');
      s += `<g class="sim-detonation-layer" style="transform-origin:${origin[0].toFixed(1)}px ${origin[1].toFixed(1)}px">` +
        `<circle class="sim-flash-halo" cx="${origin[0].toFixed(1)}" cy="${origin[1].toFixed(1)}" r="${Math.max(70, fireballPx * 5).toFixed(1)}"/>` +
        `<circle class="sim-flash-core" cx="${origin[0].toFixed(1)}" cy="${origin[1].toFixed(1)}" r="${Math.max(12, fireballPx * 1.35).toFixed(1)}"/>` +
        `<circle class="sim-fireball-bloom" cx="${origin[0].toFixed(1)}" cy="${origin[1].toFixed(1)}" r="${fireballPx.toFixed(2)}"/>` +
        `<circle class="sim-dustwave" cx="${origin[0].toFixed(1)}" cy="${origin[1].toFixed(1)}" r="${Math.min(shockPx * .62, 260).toFixed(1)}"/>` +
        `<circle class="sim-shockwave sim-shockwave-a" cx="${origin[0].toFixed(1)}" cy="${origin[1].toFixed(1)}" r="${shockPx.toFixed(1)}"/>` +
        `<circle class="sim-shockwave sim-shockwave-b" cx="${origin[0].toFixed(1)}" cy="${origin[1].toFixed(1)}" r="${shockPx.toFixed(1)}"/>` +
        debris +
        `</g>`;
    }
    // comparison: Hiroshima footprint
    if (!S.effectsCleared && S.compare) {
      const h = P.effects(15, 'air');
      const hr = h.rings.find(x => x.key === 'psi5');
      if (hr) {
        const px = kmToPx(hr.km);
        s += `<circle cx="${origin[0].toFixed(1)}" cy="${origin[1].toFixed(1)}" r="${px.toFixed(2)}" fill="none" stroke="#ffffff" stroke-width="1.4" stroke-dasharray="5 4" stroke-opacity=".85"/>`;
        if (px > 22) s += `<text class="sim-city" x="${origin[0] + 4}" y="${(origin[1] - px - 4).toFixed(1)}" fill="#fff">Hiroshima's blast area</text>`;
      }
    }
    // ground zero
    s += `<circle cx="${origin[0].toFixed(1)}" cy="${origin[1].toFixed(1)}" r="3" fill="#fff"/>`;
    s += `<line x1="${origin[0] - 9}" y1="${origin[1]}" x2="${origin[0] + 9}" y2="${origin[1]}" stroke="#fff" stroke-width="1"/>`;
    s += `<line x1="${origin[0]}" y1="${origin[1] - 9}" x2="${origin[0]}" y2="${origin[1] + 9}" stroke="#fff" stroke-width="1"/>`;
    // wind arrow
    if (S.fallout && eff.fallout) {
      const a = (90 - S.windBearing) * Math.PI / 180;
      const L = Math.min(VB.w, VB.h) * 0.36;
      const x2 = origin[0] + Math.cos(a) * L, y2 = origin[1] - Math.sin(a) * L;
      s += `<line x1="${origin[0]}" y1="${origin[1]}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#c07cff" stroke-width="1.2" stroke-dasharray="4 4" opacity=".7"/>`;
      s += `<text class="sim-city" x="${x2.toFixed(1)}" y="${(y2 - 6).toFixed(1)}" fill="#c07cff" text-anchor="middle">wind ${bearingName(S.windBearing)}</text>`;
    }
    svg.innerHTML = s;
    svg.classList.toggle('is-detonating', S.detonationPhase === 'animating');
    updateOsmTiles();
    updateDetonationControl();
    el('simScaleLabel').textContent = 'View ' + fmtKm(S.view.spanKm * 2) + ' across · click the map to move ground zero';
    el('simWindVal').textContent = bearingName(S.windBearing);
    el('simWindSpeedVal').textContent = S.windMph + ' mph';
    el('simWindRow').style.display = S.fallout ? '' : 'none';
    el('simWindSpeedRow').style.display = S.fallout ? '' : 'none';
    el('simHobVal').textContent = eff.hobM > 0 ? fmtInt(eff.hobM) + ' m' : 'ground';
    if (!S._hobDragging) {
      const full = P.optimumHob(S.yieldKt, 1) * 1.15;
      el('simHob').value = Math.round(Math.min(100, eff.hobM / full * 100));
    }
    el('simHobNote').innerHTML = eff.hobM > 0
      ? `Detonated ${fmtInt(eff.hobM)} m up. ${eff.suppressed.length
          ? `<b style="color:#FFB92E">At this height the ${eff.suppressed.map(x => x.psi + ' psi').join(' and ')} ring never reaches the ground</b> — go lower for total destruction at the centre, higher to spread damage wider.`
          : 'Lower concentrates the destruction; higher spreads it wider but weakens it.'}`
      : `Detonated at ground level: a crater, far more fallout, and a smaller blast radius than the same weapon burst in the air.`;
    el('simYieldVal').textContent = fmtKt(S.yieldKt);
    const p = presetByKey(S.weaponKey);
    el('simWeaponNote').textContent = p && p.note ? p.note : '';

    /* ---- legend ---- */
    el('simLegend').innerHTML = '<div class="res-head" style="margin-bottom:6px">Radius from ground zero</div>' +
      rings.map(r => `<div class="sl-row"><span class="sl-sw" style="background:${r.color};color:${r.color}"></span><span class="sl-l">${esc(r.label)}</span><span class="sl-v">${fmtKm(r.km)}</span></div>`).join('');

    /* ---- results ---- */
    const psi5 = eff.rings.find(r => r.key === 'psi5');
    const area = psi5 ? Math.PI * psi5.km * psi5.km : 0;
    const hiro = P.hiroshimas(S.yieldKt);
    let h = '<div class="res-head">What this does</div>';
    h += '<div class="res-big">' +
      `<div class="res-cell"><div class="res-n">${fmtKt(S.yieldKt)}</div><div class="res-l">yield</div></div>` +
      `<div class="res-cell"><div class="res-n">${hiro >= 10 ? Math.round(hiro) : hiro.toFixed(1)}×</div><div class="res-l">Hiroshima</div></div>` +
      `<div class="res-cell"><div class="res-n">${area >= 100 ? fmtInt(area) : area.toFixed(1)}</div><div class="res-l">km² flattened</div></div>` +
      '</div>';

    if (cas && cas.cityPop) {
      h += `<div class="res-big">` +
        `<div class="res-cell" style="border-color:rgba(255,110,26,.5)"><div class="res-n" style="color:#FF8A4D">${fmtBig(cas.deadRange.lo)}–${fmtBig(cas.deadRange.hi)}</div><div class="res-l">killed</div></div>` +
        `<div class="res-cell" style="border-color:rgba(255,185,46,.5)"><div class="res-n" style="color:#FFB92E">${fmtBig(cas.injuredRange.lo)}–${fmtBig(cas.injuredRange.hi)}</div><div class="res-l">injured</div></div>` +
        `</div>`;
      h += `<div class="res-desc" style="margin:-6px 0 12px">In <b style="color:#fff">${esc(S.target.name)}</b>${S.target.country ? ', ' + esc(S.target.country) : ''} — urban population ${fmtBig(cas.cityPop)}. Ranges, not predictions: the answer swings by a factor of two on the time of day alone. There are only a few thousand specialist burn beds on the entire planet.</div>`;
    } else {
      h += `<div class="res-desc" style="margin-bottom:12px">Ground zero: <b style="color:#fff">${esc(S.target.name)}</b>. Too few people here to estimate casualties — pick a city to see them.</div>`;
    }

    if (eff.heatOutrunsBlast) {
      h += `<div class="res-desc" style="margin:0 0 12px;padding:8px 10px;border-radius:9px;background:rgba(255,185,46,.10);border:1px solid rgba(255,185,46,.3);color:#ffd894">` +
        `<b style="color:#FFB92E">Notice the order of the rings.</b> The burn radius is <b>${eff.heatVsBlast.toFixed(1)}×</b> the radius in which homes collapse. ` +
        `Heat spreads further than pressure and the gap widens with yield, so a large weapon is mostly an incendiary — the fires do more than the blast, and they all start at the same instant across the whole area.</div>`;
    }

    h += '<div class="res-head">Effects, outward from the centre</div>';
    rings.forEach(r => {
      const dim = r.key === 'rem500' && eff.radiationIrrelevant;
      const t = r.arrivalS != null && r.arrivalS > 1.5
        ? `<span style="color:#8c9cab"> · shockwave arrives ${r.arrivalS < 60 ? Math.round(r.arrivalS) + ' s' : Math.round(r.arrivalS / 60) + ' min'} after the flash</span>` : '';
      h += `<div class="res-row"${dim ? ' style="opacity:.55"' : ''}><span class="res-sw" style="background:${r.color};color:${r.color}"></span>` +
        `<span class="res-txt"><span class="res-name">${esc(r.label)}</span><span class="res-desc">${esc(r.lay)}${t}` +
        (dim ? ' <b style="color:#8c9cab">At this yield prompt radiation is not what determines survival — blast and fire reach much further.</b>' : '') +
        `</span></span><span class="res-km">${fmtKm(r.km)}</span></div>`;
    });
    if (S.fallout && eff.fallout && eff.fallout.length) {
      h += '<div class="res-head" style="margin-top:14px">Fallout, downwind</div>';
      eff.fallout.forEach(f => {
        const lay = f.rate >= 1000 ? 'Lethal within an hour of exposure.'
          : f.rate >= 100 ? 'A fatal dose in a few hours in the open.'
          : f.rate >= 10 ? 'Serious radiation sickness without shelter; evacuate.'
          : 'Detectable and unsafe to live in without decontamination.';
        h += `<div class="res-row"><span class="res-sw" style="background:#c07cff;color:#c07cff;opacity:${(0.35 + 0.65 * (1 - [1000, 100, 10, 1].indexOf(f.rate) / 3)).toFixed(2)}"></span>` +
          `<span class="res-txt"><span class="res-name">${fmtInt(f.rate)} rad/hour at 1 hour</span><span class="res-desc">${lay}</span></span>` +
          `<span class="res-km">${fmtKm(f.downwindKm)}</span></div>`;
      });
    }
    if (eff.crater) {
      h += `<div class="res-row"><span class="res-sw" style="background:#c9a227;color:#c9a227"></span>` +
        `<span class="res-txt"><span class="res-name">Crater</span><span class="res-desc">${fmtKm(eff.crater.radius * 2)} across and about ${Math.round(eff.crater.depth * 1000)} m deep. That soil becomes the fallout.</span></span>` +
        `<span class="res-km">${fmtKm(eff.crater.radius)}</span></div>`;
    }
    /* Anchors: attach the yield to something the reader has actually seen. */
    const anch = P.ANCHORS.filter(a => a.kt < S.yieldKt * 0.9).slice(-2);
    if (anch.length) {
      h += '<div class="res-head" style="margin-top:14px">For scale</div>';
      anch.forEach(a => {
        h += `<div class="res-row"><span class="res-txt"><span class="res-desc">This is <b style="color:#fff">${fmtInt(S.yieldKt / a.kt)}×</b> ${esc(a.name)}.</span></span></div>`;
      });
    }

    /* Plain-language summary — also the screen-reader equivalent of the map. */
    h += `<div class="res-head" style="margin-top:14px">In words</div>` +
      `<div class="res-desc" style="line-height:1.6">${esc(P.narrate(eff, S.target.name, cas))}</div>`;

    el('simResults').innerHTML = h;
    el('simMap').setAttribute('aria-label', P.narrate(eff, S.target.name, cas));

    el('simCaveat').innerHTML =
      `Radii come from the standard scaling equations in <i>The Effects of Nuclear Weapons</i> (Glasstone &amp; Dolan, US Government, public domain), assuming clear weather, flat ground and ${S.burst === 'air' ? 'a burst height of about ' + fmtInt(eff.optimumBurstHeightM) + ' m' : 'a detonation at ground level'}. ` +
      `Casualty figures are modelled from a population profile, and should be read as <b>evocative rather than definitive</b>. ` +
      `This is an educational resource. It is not suitable for emergency planning or emergency response, and it is not a perfect simulation.`;
  }

  function syncTargetSelect() {
    const sel = el('simTarget');
    if (!sel || !S._cities) return;
    if (S.target && S.target.adhoc) { sel.value = ''; return; }
    const i = S._cities.findIndex(c => c.name === S.target.name && c.lat === S.target.lat);
    sel.value = i >= 0 ? 'c' + i : '';
  }
  function niceStep(x) {
    const p = Math.pow(10, Math.floor(Math.log10(Math.max(0.001, x))));
    const n = x / p;
    return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p;
  }

  /* Teardrop fallout plume, pointing downwind. */
  function craterMarkup(origin, crater, extraClass) {
    const craterPx = Math.max(2.2, kmToPx(crater.radius));
    return `<g class="sim-crater${extraClass ? ' ' + extraClass : ''}" style="transform-origin:${origin[0].toFixed(1)}px ${origin[1].toFixed(1)}px">` +
      `<circle class="sim-crater-rim" cx="${origin[0].toFixed(1)}" cy="${origin[1].toFixed(1)}" r="${(craterPx * 1.34).toFixed(2)}"/>` +
      `<circle class="sim-crater-core" cx="${origin[0].toFixed(1)}" cy="${origin[1].toFixed(1)}" r="${craterPx.toFixed(2)}"/>` +
      `</g>`;
  }

  function falloutPath(f, origin, opacity, bearing, className) {
    const brg = bearing == null ? S.windBearing : bearing;
    const a = (90 - brg) * Math.PI / 180;
    const ux = Math.cos(a), uy = -Math.sin(a);          // downwind unit vector in screen space
    const vx = -uy, vy = ux;                            // perpendicular
    const L = kmToPx(f.downwindKm), W = kmToPx(f.widthKm);
    if (L < 3) return '';
    const pts = [];
    const N = 34;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      // teardrop half-width: rises quickly, tapers to a point downwind
      const hw = W * Math.pow(t, 0.42) * Math.pow(1 - t, 0.55) * 2.2;
      pts.push([origin[0] + ux * L * t + vx * hw, origin[1] + uy * L * t + vy * hw]);
    }
    for (let i = N; i >= 0; i--) {
      const t = i / N;
      const hw = W * Math.pow(t, 0.42) * Math.pow(1 - t, 0.55) * 2.2;
      pts.push([origin[0] + ux * L * t - vx * hw, origin[1] + uy * L * t - vy * hw]);
    }
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('') + 'Z';
    return `<path${className ? ` class="${className}"` : ''} d="${d}" fill="#c07cff" fill-opacity="${opacity}" stroke="#c07cff" stroke-opacity="${(opacity * 2.6).toFixed(2)}" stroke-width="1"/>`;
  }

  /* --------------------------------------------------------- arsenal mode */
  function renderArsenal() {
    updateDetonationControl();
    const iso = S.arsenalIso;
    const n = A().seriesAt(iso, A().Y1) || 0;
    const types = (A().WTYPES || []).filter(w => w.iso3 === iso && w.kt && w.count);
    const totalCounted = types.reduce((a, w) => a + w.count, 0);

    /* Build the strike list: the world's largest cities, one warhead each,
       largest warheads on the largest cities. If the arsenal has more warheads
       than we have cities, the surplus is stated rather than drawn. */
    const cities = (A().CITIES || []).slice().sort((a, b) => (b.pop || 0) - (a.pop || 0));
    const pool = [];
    if (types.length) types.forEach(w => { for (let i = 0; i < w.count; i++) pool.push(w.kt); });
    /* The published warhead-by-warhead tables never quite add up to the
       headline inventory. Pad the remainder at the arsenal's average yield so
       the totals match what the rest of the map says this country has. */
    if (pool.length < n) {
      const mt = A().mtAt(iso, A().Y1);
      const counted = pool.reduce((a, b) => a + b, 0);
      const rest = Math.max(0, (mt ? mt * 1000 : n * 300) - counted);
      const per = rest > 0 ? rest / (n - pool.length) : (pool.length ? counted / pool.length : 300);
      for (let i = pool.length; i < n; i++) pool.push(per);
    } else if (pool.length > n) {
      pool.sort((a, b) => b - a);
      pool.length = n;
    }
    pool.sort((a, b) => b - a);

    const used = Math.min(pool.length, cities.length);
    const strikes = [];
    for (let i = 0; i < used; i++) strikes.push({ city: cities[i], kt: pool[i] });

    let dead = 0, injured = 0, popHit = 0, totalKt = 0;
    strikes.forEach(s => {
      const eff = P.effects(s.kt, 'air');
      const c = P.casualties(eff, s.city);
      if (c) { dead += c.dead; injured += c.injured; popHit += c.cityPop; }
      s.psi5 = (eff.rings.find(r => r.key === 'psi5') || {}).km || 0;
      totalKt += s.kt;
    });
    const arsenalKt = pool.reduce((a, b) => a + b, 0);

    /* world map */
    const svg = el('simMap');
    svg.setAttribute('viewBox', `0 0 ${VB.w} ${VB.h}`);
    const W = VB.w, H = VB.h;
    const pw = Math.min(W / 360, H / 180);
    const px = lon => W / 2 + lon * pw, py = lat => H / 2 - lat * pw;
    let s = S.basemap === 'osm' ? '' : `<rect x="0" y="0" width="${W}" height="${H}" fill="#060a0f"/>`;
    const rings = landPaths();
    let d = '';
    for (const ring of rings) {
      const step = ring.length > 4000 ? 5 : ring.length > 1200 ? 3 : 1;
      for (let i = 0; i < ring.length; i += step) d += (i ? 'L' : 'M') + px(ring[i][0]).toFixed(1) + ',' + py(ring[i][1]).toFixed(1);
      d += 'Z';
    }
    if (S.basemap !== 'osm') s += `<path class="sim-land" d="${d}"/>`;
    strikes.forEach(st => {
      const x = px(st.city.lon), y = py(st.city.lat);
      const r = Math.max(1.6, st.psi5 * pw / 111.32);
      s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="#ff3b30" fill-opacity=".38" stroke="#ff8c1a" stroke-width=".7" stroke-opacity=".8"><title>${esc(st.city.name)} — ${fmtKt(st.kt)}</title></circle>`;
    });
    /* Caption goes at the top: the bottom of the map belongs to the scale bar. */
    s += `<text class="sim-city" x="14" y="20" font-size="11">${esc(A().nameOf(iso))} · ${fmtInt(used)} warheads placed on the ${fmtInt(used)} largest cities</text>`;
    s += `<text class="sim-city" x="14" y="35" font-size="11" opacity=".75">Each circle is that city's blast-destruction radius, drawn to scale</text>`;
    svg.innerHTML = s;
    updateOsmTiles();

    el('simScaleLabel').textContent = 'World view · each circle is a city inside the 5 psi blast radius';
    el('simLegend').innerHTML = '<div class="res-head" style="margin-bottom:6px">This is one arsenal</div>' +
      `<div class="sl-row"><span class="sl-sw" style="background:#ff3b30;color:#ff3b30"></span><span class="sl-l">Blast destruction</span><span class="sl-v">${fmtInt(used)}</span></div>` +
      `<div class="sl-row"><span class="sl-l">Warheads unplaced</span><span class="sl-v">${fmtInt(Math.max(0, pool.length - used))}</span></div>`;

    el('simArsenalNote').textContent = types.length
      ? `Using ${A().possessive(A().nameOf(iso))} actual warhead mix: ${types.slice(0, 4).map(t => t.name + ' (' + fmtKt(t.kt) + ' × ' + fmtInt(t.count) + ')').join(', ')}${types.length > 4 ? ', and others' : ''}.`
      : `No published warhead-by-warhead breakdown for ${A().theName(A().nameOf(iso))} — using its average yield across the whole arsenal.`;

    let h = '<div class="res-head">If one country used everything it has</div>';
    h += '<div class="res-big">' +
      `<div class="res-cell"><div class="res-n">${fmtInt(pool.length)}</div><div class="res-l">warheads</div></div>` +
      `<div class="res-cell"><div class="res-n">${(arsenalKt / 1000).toFixed(arsenalKt >= 100000 ? 0 : 1)}</div><div class="res-l">megatons</div></div>` +
      `<div class="res-cell"><div class="res-n">${fmtInt(P.hiroshimas(arsenalKt))}</div><div class="res-l">× Hiroshima</div></div>` +
      '</div>';
    h += '<div class="res-big">' +
      `<div class="res-cell" style="border-color:rgba(255,59,48,.5)"><div class="res-n" style="color:#ff6b5e">${fmtBig(dead)}</div><div class="res-l">killed within days</div></div>` +
      `<div class="res-cell" style="border-color:rgba(255,140,26,.5)"><div class="res-n" style="color:#ffab52">${fmtBig(injured)}</div><div class="res-l">injured</div></div>` +
      '</div>';
    h += `<div class="res-desc" style="margin-bottom:14px">Placed one per city on the ${fmtInt(used)} largest urban areas on Earth, home to ${fmtBig(popHit)} people between them.</div>`;
    h += '<div class="res-head">And then the part the map cannot draw</div>';
    let nw = (window.NUKE_HUMAN && window.NUKE_HUMAN.nuclearWinter) || [];
    if (nw.length) {
      /* Show the scenarios that actually bear on the arsenal being simulated:
         a US or Russian exchange, or a regional one, not all five variants. */
      const big = pool.length > 500;
      const rank = x => {
        const s = (x.scenario || '').toLowerCase();
        const superpower = /us|nato|russia|soviet/.test(s) && !/india|pakistan/.test(s);
        return (big === superpower ? 0 : 1) * 10 + (x.weapons ? Math.abs(Math.log((x.weapons || 1) / Math.max(1, pool.length))) : 5);
      };
      nw = nw.slice().sort((a, b) => rank(a) - rank(b)).slice(0, 3);
      nw.forEach(x => {
        const bits = [];
        if (x.sootTg) bits.push(x.sootTg + ' Tg of soot into the stratosphere');
        if (x.tempDropC) bits.push(x.tempDropC + '°C of global cooling');
        if (x.famineDeaths) bits.push(/food|famine|starv/i.test(x.famineDeaths) ? x.famineDeaths : x.famineDeaths + ' at risk of famine');
        h += `<div class="res-row"><span class="res-sw" style="background:#7ee787;color:#7ee787"></span>` +
          `<span class="res-txt"><span class="res-name">${esc(x.scenario)}</span><span class="res-desc">${esc(bits.join(' · '))}` +
          (x.source ? `<span style="display:block;color:#6f8091;margin-top:2px">${esc(String(x.source).slice(0, 90))}</span>` : '') +
          `</span></span></div>`;
      });
    } else {
      h += `<div class="res-desc">Soot from burning cities would cool the planet for years and collapse harvests worldwide. Peer-reviewed estimates put the famine deaths from even a regional exchange far above the deaths from the explosions themselves.</div>`;
    }
    el('simResults').innerHTML = h;
    el('simCaveat').innerHTML = 'This is a deliberately crude illustration of scale, not a scenario. Real war planning does not put one warhead on each of the world\'s biggest cities, many warheads would be used on military targets, and many would fail or be intercepted. The point is only the order of magnitude — and that no arsenal on this list can be used without ending the society that uses it.';
  }

  /* ------------------------------------------------------------- open/close */
  function defaultTarget() {
    const cities = (A().CITIES || []).slice().sort((a, b) => (b.pop || 0) - (a.pop || 0));
    return cities[0] || { name: 'Central London', lat: 51.5072, lon: -0.1276, pop: 9600000, dens: 5700, country: 'United Kingdom' };
  }
  function open(opts) {
    build();
    opts = opts || {};
    resetDetonation();
    S.open = true;
    if (opts.mode) {
      S.mode = opts.mode;
      el('simMode').querySelectorAll('.seg-b').forEach(x => x.classList.toggle('on', x.dataset.mode === S.mode));
      el('simWeaponGroup').style.display = S.mode === 'single' ? '' : 'none';
      el('simArsenalGroup').style.display = S.mode === 'arsenal' ? '' : 'none';
    }
    if (opts.iso) { S.arsenalIso = opts.iso; el('simArsenal').value = opts.iso; }
    if (opts.lat != null) {
      S.target = nearestCityOrPoint(opts.lat, opts.lon);
      setViewCenter(S.target.lat, S.target.lon);
      if (opts.name) S.target.name = opts.name;
      el('simTarget').value = '';
    }
    if (!S.target) {
      S.target = defaultTarget();
      setViewCenter(S.target.lat, S.target.lon);
    }
    if (opts.kt) {
      S.yieldKt = opts.kt; el('simYield').value = ktToSlider(opts.kt);
      S.weaponKey = 'custom'; el('simWeapon').value = 'custom';
    }
    el('simOverlay').classList.remove('hidden');
    if (S.mode === 'single' && opts.fit !== false) fitToEffects();
    requestAnimationFrame(() => { measure(); render(); });
  }
  function close() {
    resetDetonation();
    S.open = false;
    el('simOverlay').classList.add('hidden');
  }

  window.addEventListener('resize', () => { if (S.open) render(); });
  window.addEventListener('nuke:languagechange', () => {
    if (!built) return;
    buildLists();
    el('simWeapon').value = S.weaponKey;
    el('simArsenal').value = S.arsenalIso;
    el('simBasemap').querySelectorAll('.seg-b').forEach(x => x.classList.toggle('on', x.dataset.basemap === S.basemap));
    syncTargetSelect();
    if (S.open) render();
  });

  /* ------------------------------------------------------------------ wiring */
  function init() {
    el('simBtn').addEventListener('click', () => open({ mode: 'single' }));
    el('detailSim').addEventListener('click', () => {
      const iso = A().state.selected;
      if (!iso) return;
      open({ mode: 'arsenal', iso });
    });
    el('siteSim').addEventListener('click', () => {
      const s = A().SITES.find(x => x.id === A().state.selectedSite);
      if (!s) return;
      if (s.lat == null) { A().showToast('No published coordinate for this site'); return; }
      const kt = (s.yieldKt && s.yieldKt.length) ? Math.max.apply(null, s.yieldKt) : 300;
      open({ mode: 'single', lat: s.lat, lon: s.lon, name: s.name, kt });
    });
    // validate the physics against published check values, if we shipped any
    try { P.selfTest(); } catch (e) { console.warn(e); }
  }

  window.NukeBlast = { init, open, close, get state() { return S; } };
})();
