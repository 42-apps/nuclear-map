/* ============================================================================
   physics.js — nuclear weapon effects.

   Every relation here comes from "The Effects of Nuclear Weapons" (Glasstone &
   Dolan, US Government Printing Office, 3rd edn 1977 — public domain), with the
   fallout contours from its Table 9.93 and the casualty fractions from the DCPA
   Attack Environment Manual (1973) as reprinted by the US Office of Technology
   Assessment in "The Effects of Nuclear War" (1979).

   This is unclassified, decades-old, published civil-defence maths. It tells
   you how big the effects are. It says nothing about how to build a weapon and
   nothing about targeting.

   Units: yield Y in kilotons of TNT, burst height in METRES, radii in KILOMETRES.
   window.NUKE_PHYSICS_COEF deep-merges over COEF to recalibrate without edits.
   ========================================================================== */
'use strict';

(function (root) {

  const pow = Math.pow, sqrt = Math.sqrt;

  /* ---------------------------------------------------------------- constants */
  const DEFAULT_COEF = {
    /* Blast. For each peak overpressure: the ground range coefficient for a
       contact surface burst (`surf`), the maximum achievable ground range at
       that ring's own best burst height (`air`), that best height (`optHob`),
       and the height above which the ring stops existing at all (`maxHob`).
       Ranges are km per kt^(1/3); heights are metres per kt^(1/3). */
    blast: {
      1:  { surf: 1.1765, air: 2.1400, optHob: 467, maxHob: 1545 },
      2:  { surf: 0.7797, air: 1.2823, optHob: 335, maxHob: 979 },
      3:  { surf: 0.6436, air: 1.0008, optHob: 306, maxHob: 807 },
      5:  { surf: 0.4578, air: 0.7042, optHob: 304, maxHob: 570 },
      10: { surf: 0.3121, air: 0.4435, optHob: 221, maxHob: 384 },
      12: { surf: 0.2870, air: 0.4107, optHob: 217, maxHob: 357 },
      20: { surf: 0.2176, air: 0.2810, optHob: 182, maxHob: 282 },
      30: { surf: 0.1804, air: 0.1957, optHob: 153, maxHob: 239 },
    },
    /* The default airburst height: high enough to spread blast over a city,
       low enough that the heavy-damage ring still exists. In scaled terms this
       is close to the height used over Hiroshima. Metres per kt^(1/3). */
    defaultHobPerCubeRoot: 228,

    /* Fireball, maximum radius. km per kt^0.4. */
    fireball: { air: 0.06096, surface: 0.07925, exp: 0.4 },
    /* Below this burst height the fireball touches the ground and lifts soil
       into the cloud — which is what creates local fallout. km. */
    falloutHeightThreshold: { c: 0.054863, exp: 0.4 },

    /* Thermal. SLANT range in km; converted to ground range using burst height.
       Two regimes because the pulse lengthens with yield: skin sheds heat, so
       the exponent falls from ~0.44 at kiloton scale to ~0.40 at megaton scale. */
    thermal: {
      burn3: { a: 0.5989, b: 0.4408, hiA: 0.7948, hiB: 0.3998 },
      burn2: { a: 0.7858, b: 0.4407, hiA: 1.0790, hiB: 0.3948 },
      burn1: { a: 1.1196, b: 0.4330, hiA: 1.5713, hiB: 0.3839 },
      none:  { a: 1.4410, b: 0.4299, hiA: 1.9023, hiB: 0.3897 },
      surfaceFactor: 0.87,
      visibility: { clear: 1, hazy: 0.7, fog: 0.5 },
    },

    /* Prompt radiation. SLANT range in km. The exponent is ~0.15 against 0.33
       for blast and ~0.44 for thermal, which is why it decides nothing above a
       few tens of kilotons — the blast has already gone further. */
    radiation: {
      rem1000: { a: 0.7871, b: 0.1574, hiA: 0.6314, hiB: 0.1893 },
      rem500:  { a: 0.8956, b: 0.1488, hiA: 0.7234, hiB: 0.1797 },
      rem100:  { a: 1.1694, b: 0.1308, hiA: 0.9534, hiB: 0.1604 },
      surfaceFactor: 2 / 3,
    },

    /* Crater, contact surface burst in soil. Metres per kt^(1/3). */
    crater: { radiusM: 19.30, depthM: 9.235, lipFactor: 1.25, ejectaFactor: 2.15 },

    /* Fallout: Glasstone & Dolan Table 9.93, idealised H+1 dose-rate contours
       for a contact surface burst at a 15 mph wind with 15 degrees of shear.
       d/w/g are downwind, maximum-width and upwind extents in statute miles at
       1 kt; dn/wn/gn are their yield exponents. */
    fallout: {
      refWindMph: 15, miToKm: 1.609344, fissionFraction: 0.5,
      table: {
        1:    { d: 40,   dn: 0.45, w: 3.3,    wn: 0.48, g: 1.5,   gn: 0.41 },
        3:    { d: 30,   dn: 0.45, w: 2.2,    wn: 0.50, g: 0.89,  gn: 0.41 },
        10:   { d: 24,   dn: 0.45, w: 1.4,    wn: 0.53, g: 0.68,  gn: 0.41 },
        30:   { d: 16,   dn: 0.45, w: 0.76,   wn: 0.56, g: 0.53,  gn: 0.41 },
        100:  { d: 8.9,  dn: 0.45, w: 0.38,   wn: 0.60, g: 0.39,  gn: 0.42 },
        300:  { d: 4.5,  dn: 0.45, w: 0.13,   wn: 0.66, g: 0.20,  gn: 0.48 },
        1000: { d: 1.8,  dn: 0.45, w: 0.036,  wn: 0.76, g: 0.06,  gn: 0.57 },
        3000: { d: 0.95, dn: 0.45, w: 0.0076, wn: 0.86, g: 0.026, gn: 0.58 },
      },
      decayExp: -1.2,
    },

    /* Casualty fractions by overpressure band, for people caught in the open or
       in ordinary buildings. DCPA (1973) via OTA (1979). */
    casualty: [
      { minPsi: 12, dead: 0.98, hurt: 0.02 },
      { minPsi: 5,  dead: 0.50, hurt: 0.40 },
      { minPsi: 2,  dead: 0.05, hurt: 0.45 },
      { minPsi: 1,  dead: 0.00, hurt: 0.25 },
    ],
  };

  function deepMerge(a, b) {
    const out = Array.isArray(a) ? a.slice() : Object.assign({}, a);
    for (const k in b) {
      if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') out[k] = deepMerge(a[k], b[k]);
      else out[k] = b[k];
    }
    return out;
  }
  const COEF = deepMerge(DEFAULT_COEF, root.NUKE_PHYSICS_COEF || {});

  const cbrt = Y => pow(Y, 1 / 3);
  /* Dual-regime power law: the low-yield fit below the crossover, the
     high-yield fit above it, so the two meet continuously. */
  function dualLaw(c, Y) {
    const cross = pow(c.hiA / c.a, 1 / (c.b - c.hiB));
    return Y <= cross ? c.a * pow(Y, c.b) : c.hiA * pow(Y, c.hiB);
  }

  /* --------------------------------------------------------------- burst height */
  const defaultHob = Y => COEF.defaultHobPerCubeRoot * cbrt(Y);          // metres
  const optimumHob = (Y, psi) => (COEF.blast[psi] ? COEF.blast[psi].optHob * cbrt(Y) : null);
  const maxHob = (Y, psi) => (COEF.blast[psi] ? COEF.blast[psi].maxHob * cbrt(Y) : null);
  /* Above this height the fireball never touches the ground, so there is no
     significant local fallout — the price of that is a smaller crater and a
     smaller heavy-damage ring. */
  const falloutFreeHeight = Y => COEF.falloutHeightThreshold.c * pow(Y, COEF.falloutHeightThreshold.exp) * 1000;

  /* ------------------------------------------------------------------ blast */
  /* Ground range to a given peak overpressure, for a burst at height hobM.
     Returns 0 when the burst is too high for that overpressure to reach the
     ground at all — which is a real and important effect, not an error: an
     airburst tuned to flatten a whole city gives up total destruction at the
     centre. */
  function blastRadius(Y, psi, hobM) {
    const c = COEF.blast[psi];
    if (!c || !(Y > 0)) return null;
    const k = cbrt(Y);
    const h = hobM == null ? defaultHob(Y) : Math.max(0, hobM);
    if (h <= 0) return c.surf * k;
    const opt = c.optHob * k, max = c.maxHob * k;
    if (h >= max) return 0;
    const s = c.surf / c.air;
    const f = h <= opt
      ? s + (1 - s) * sqrt(h / opt)                       // rising to the optimum
      : pow((max - h) / (max - opt), 0.8);                // falling away above it
    return c.air * k * f;
  }
  /* Time for the shock front to arrive, in seconds. It starts supersonic and
     settles to the speed of sound. */
  function blastArrivalSeconds(km, Y) {
    const m = km * 1000, scale = 340 * cbrt(Y);
    return m / 340 * (1 - 0.30 * Math.exp(-m / (3 * scale)));
  }

  /* ---------------------------------------------------------------- fireball */
  function fireballRadius(Y, hobM) {
    const c = COEF.fireball;
    const touching = (hobM == null ? defaultHob(Y) : hobM) <= 0;
    return (touching ? c.surface : c.air) * pow(Y, c.exp);
  }

  /* ------------------------------------------------- thermal and radiation */
  const slantToGround = (slantKm, hobM) => {
    const h = (hobM || 0) / 1000;
    return slantKm <= h ? 0 : sqrt(slantKm * slantKm - h * h);
  };
  function thermalRadius(Y, level, hobM, visibility) {
    const c = COEF.thermal[level];
    if (!c) return null;
    let slant = dualLaw(c, Y) * (COEF.thermal.visibility[visibility || 'clear'] || 1);
    if ((hobM == null ? defaultHob(Y) : hobM) <= 0) slant *= COEF.thermal.surfaceFactor;
    return slantToGround(slant, hobM == null ? defaultHob(Y) : hobM);
  }
  function radiationRadius(Y, rem, hobM) {
    const c = COEF.radiation['rem' + rem];
    if (!c) return null;
    let slant = dualLaw(c, Y);
    if ((hobM == null ? defaultHob(Y) : hobM) <= 0) slant *= COEF.radiation.surfaceFactor;
    return slantToGround(slant, hobM == null ? defaultHob(Y) : hobM);
  }
  const thermalPulseSeconds = Y => 0.0417 * pow(Y, 0.44) * 10;

  /* ----------------------------------------------------------------- crater */
  function crater(Y, hobM) {
    if ((hobM == null ? defaultHob(Y) : hobM) > 0) return null;
    const k = cbrt(Y);
    const r = COEF.crater.radiusM * k / 1000, d = COEF.crater.depthM * k / 1000;
    return { radius: r, depth: d, lipRadius: r * COEF.crater.lipFactor, ejectaRadius: r * COEF.crater.ejectaFactor };
  }

  /* ---------------------------------------------------------------- fallout */
  /* An H+1 dose-rate contour, as a teardrop measured from ground zero. Local
     fallout needs the fireball to touch the ground, so this is a surface-burst
     effect only. `hours` re-labels the contour using t^-1.2 decay. */
  function falloutContour(Y, radsPerHour, opts) {
    opts = opts || {};
    const hobM = opts.hobM == null ? 0 : opts.hobM;
    if (hobM > falloutFreeHeight(Y)) return null;
    const f = COEF.fallout;
    const ff = opts.fissionFraction || f.fissionFraction;
    const hours = opts.hours || 1;
    /* Geometry follows total yield; the dose-rate LABEL scales with the fission
       yield, so look the table up at rate/ff — and shift for decay. */
    const lookup = radsPerHour * pow(hours, -f.decayExp) / ff;
    const keys = Object.keys(f.table).map(Number).sort((a, b) => a - b);
    if (lookup < keys[0] || lookup > keys[keys.length - 1]) return null;
    let lo = keys[0], hi = keys[keys.length - 1];
    for (let i = 0; i < keys.length - 1; i++) {
      if (keys[i] <= lookup && lookup <= keys[i + 1]) { lo = keys[i]; hi = keys[i + 1]; break; }
    }
    const A = f.table[lo], B = f.table[hi];
    /* interpolate in log(dose rate), which is how the contours are spaced */
    const t = lo === hi ? 0 : (Math.log(lookup) - Math.log(lo)) / (Math.log(hi) - Math.log(lo));
    const mix = (a, b) => a + (b - a) * t;
    const dMi = mix(A.d, B.d) * pow(Y, mix(A.dn, B.dn));
    const wMi = mix(A.w, B.w) * pow(Y, mix(A.wn, B.wn));
    const gMi = mix(A.g, B.g) * pow(Y, mix(A.gn, B.gn));
    /* Wind only stretches the plume downwind; width barely moves. */
    const v = opts.windMph == null ? f.refWindMph : opts.windMph;
    const windF = v > f.refWindMph ? 1 + (v - f.refWindMph) / 60 : 1 + (v - f.refWindMph) / 30;
    return {
      rate: radsPerHour, hours,
      downwindKm: dMi * f.miToKm * windF,
      widthKm: wMi * f.miToKm,
      upwindKm: gMi * f.miToKm,
    };
  }
  const doseRateAt = (h1Rate, hours) => h1Rate * pow(hours, COEF.fallout.decayExp);

  /* ------------------------------------------------------- the full effect set */
  /* Colours are the Okabe–Ito colour-blind-safe set, adapted so every ring
     clears 4.5:1 against a near-black basemap. `fill` is the interior alpha. */
  const RINGS = [
    { key: 'fireball', label: 'Fireball',            color: '#FFE24D', fill: 0.50, dash: null, adv: false,
      lay: 'The ball of superheated gas made by the explosion itself, briefly hotter than the surface of the sun. Everything inside is vaporised.' },
    { key: 'psi20',    label: 'Most buildings destroyed', color: '#FF6E1A', fill: 0.24, dash: null, adv: false, psi: 20,
      lay: 'The pressure wave here flattens even heavily built concrete structures. Very few people in this zone survive.' },
    { key: 'burn3',    label: 'Severe burns',        color: '#FFB92E', fill: 0.13, dash: null, adv: false, therm: 'burn3',
      lay: 'The flash burns through every layer of skin and sets clothing, paper and wood alight — everywhere in this circle at the same instant.' },
    { key: 'psi5',     label: 'Homes collapse, fires spread', color: '#FF8A4D', fill: 0.13, dash: '10 4', adv: false, psi: 5,
      lay: 'Most houses and apartment blocks collapse. Injuries are close to universal, deaths are widespread, and fires start everywhere at once.' },
    { key: 'psi1',     label: 'Windows break',       color: '#FFB07A', fill: 0, dash: '4 4', adv: false, psi: 1,
      lay: 'Windows shatter out to about here. That sounds minor, but the flash arrives before the blast — people go to the window to look, and the glass reaches them. This injured tens of thousands in Hiroshima.' },
    { key: 'rem500',   label: 'Fatal radiation dose', color: '#2ED8A7', fill: 0.13, dash: '8 3 2 3', adv: false, rem: 500,
      lay: 'A burst of gamma rays and neutrons in the first instant. 500 rem kills most unprotected people within weeks without treatment that will not be available.' },
    { key: 'psi12',    label: 'Near-total destruction (12 psi)', color: '#FF6E1A', fill: 0.08, dash: null, adv: true, psi: 12,
      lay: 'The threshold civil-defence planners use for near-total fatalities.' },
    { key: 'psi10',    label: 'Severe damage (10 psi)', color: '#FF7A33', fill: 0.08, dash: null, adv: true, psi: 10,
      lay: 'Multi-storey brick and steel-frame buildings are gutted.' },
    { key: 'psi2',     label: 'Structural damage (2 psi)', color: '#FFC49A', fill: 0.05, dash: '6 4', adv: true, psi: 2,
      lay: 'Roofs and interior walls fail; widespread injuries from flying debris.' },
    { key: 'burn2',    label: 'Second-degree burns', color: '#FFD27A', fill: 0.05, dash: '3 5', adv: true, therm: 'burn2',
      lay: 'Blistering burns on any exposed skin.' },
    { key: 'burn1',    label: 'First-degree burns',  color: '#FFE9BC', fill: 0, dash: '2 6', adv: true, therm: 'burn1',
      lay: 'Sunburn-like reddening on exposed skin.' },
    { key: 'crater',   label: 'Crater',              color: '#A1A1AA', fill: 0.68, dash: null, adv: true,
      lay: 'A ground-level burst digs a bowl out of the earth. Everything that was here goes up into the cloud — and comes back down as fallout.' },
  ];

  /* burst: "air" (uses the default optimised height), "surface", or a number of
     metres for an explicit burst height. */
  function resolveHob(Y, burst) {
    if (typeof burst === 'number') return Math.max(0, burst);
    return burst === 'surface' ? 0 : defaultHob(Y);
  }

  function effects(Y, burst, opts) {
    opts = opts || {};
    const hobM = opts.hobM != null ? Math.max(0, opts.hobM) : resolveHob(Y, burst);
    const isSurface = hobM <= 0;
    const out = { yieldKt: Y, burst: isSurface ? 'surface' : 'air', hobM, rings: [], suppressed: [] };

    for (const r of RINGS) {
      let km = null;
      if (r.key === 'fireball') km = fireballRadius(Y, hobM);
      else if (r.psi) km = blastRadius(Y, r.psi, hobM);
      else if (r.therm) km = thermalRadius(Y, r.therm, hobM, opts.visibility);
      else if (r.rem) km = radiationRadius(Y, r.rem, hobM);
      else if (r.key === 'crater') { const c = crater(Y, hobM); km = c ? c.radius : null; }
      if (km == null) continue;
      if (km <= 0) {
        /* The ring genuinely does not exist at this burst height — say so
           rather than silently dropping it. */
        if (r.psi) out.suppressed.push({ key: r.key, label: r.label, psi: r.psi, maxHobM: maxHob(Y, r.psi) });
        continue;
      }
      out.rings.push({
        key: r.key, label: r.label, color: r.color, fill: r.fill, dash: r.dash,
        adv: r.adv, lay: r.lay, km,
        arrivalS: r.psi ? blastArrivalSeconds(km, Y) : null,
      });
    }
    out.rings.sort((a, b) => b.km - a.km);
    out.maxKm = out.rings.length ? out.rings[0].km : 0;
    out.pulseS = thermalPulseSeconds(Y);
    out.optimumHob5psiM = optimumHob(Y, 5);
    out.falloutFreeHeightM = falloutFreeHeight(Y);

    const g = k => { const x = out.rings.find(v => v.key === k); return x ? x.km : 0; };
    /* Thermal scales as ~Y^0.44 and blast as Y^0.33, so the burn radius pulls
       ahead as yield rises — the most useful counter-intuitive fact here. */
    out.heatVsBlast = g('psi5') ? g('burn3') / g('psi5') : 0;
    out.heatOutrunsBlast = out.heatVsBlast > 1.15;
    out.radiationIrrelevant = g('rem500') > 0 && g('rem500') < g('psi20');

    if (isSurface) {
      out.crater = crater(Y, hobM);
      out.fallout = [1000, 100, 10, 1]
        .map(rate => falloutContour(Y, rate, { hobM, windMph: opts.windMph, fissionFraction: opts.fissionFraction, hours: opts.hours }))
        .filter(Boolean);
    }
    return out;
  }

  /* ------------------------------------------------------------- population */
  /* A city is a dense core holding its stated population at its stated density,
     surrounded by suburbs whose density decays, on a rural floor. Integrating
     that radially is far more honest than smearing the metro average over a
     fifty-kilometre ring. */
  const RURAL_DENSITY = 45;
  function cityProfile(city) {
    const pop = city.pop || 0;
    const dens = Math.max(200, city.dens || 3000);
    const Ru = sqrt(pop / (Math.PI * dens));
    return { pop, dens, Ru, decay: Math.max(2, Ru * 0.7) };
  }
  function densityAt(prof, r) {
    if (r <= prof.Ru) return prof.dens;
    return Math.max(RURAL_DENSITY, prof.dens * Math.exp(-(r - prof.Ru) / prof.decay));
  }
  function popWithin(prof, r) {
    if (r <= 0) return 0;
    const steps = 90;
    let total = 0;
    for (let i = 0; i < steps; i++) {
      const r0 = r * i / steps, r1 = r * (i + 1) / steps, rm = (r0 + r1) / 2;
      total += densityAt(prof, rm) * Math.PI * (r1 * r1 - r0 * r0);
    }
    return total;
  }

  /* Casualties: walk outwards through the overpressure bands, applying each
     band's fractions to the population it newly covers. */
  function casualties(eff, city) {
    if (!city || !city.pop) return null;
    const prof = cityProfile(city);
    const Y = eff.yieldKt;
    const bands = COEF.casualty
      .map(b => ({ ...b, r: blastRadius(Y, b.minPsi, eff.hobM) || 0 }))
      .filter(b => b.r > 0)
      .sort((a, b) => a.r - b.r);

    let dead = 0, hurt = 0, prevR = 0, prevPop = 0, exposed = 0;
    for (const b of bands) {
      if (b.r <= prevR) continue;
      const p = popWithin(prof, b.r);
      const inBand = Math.max(0, p - prevPop);
      dead += inBand * b.dead;
      hurt += inBand * b.hurt;
      exposed += inBand;
      prevR = b.r; prevPop = p;
    }
    /* Burns reach beyond the blast; people outside every pressure band but
       inside the third-degree burn radius are casualties too. */
    const burn = eff.rings.find(r => r.key === 'burn3');
    if (burn && burn.km > prevR) {
      const extra = Math.max(0, popWithin(prof, burn.km) - prevPop);
      dead += extra * 0.15;
      hurt += extra * 0.5;
      exposed += extra;
    }
    /* Report a RANGE. The genuine spread between published casualty models —
       time of day, building stock, warning, sheltering — is a factor of two. */
    const band = (v, lo, hi) => ({ mid: Math.round(v), lo: Math.round(v * lo), hi: Math.round(v * hi) });
    return {
      dead: Math.round(dead), injured: Math.round(hurt), exposed: Math.round(exposed),
      deadRange: band(dead, 0.55, 1.7), injuredRange: band(hurt, 0.5, 1.9),
      cityPop: prof.pop, urbanRadiusKm: prof.Ru,
    };
  }

  /* --------------------------------------------------------------- geometry */
  const R_EARTH = 6371;
  const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
  function destination(lat, lon, bearingDeg, km) {
    const d = km / R_EARTH, br = rad(bearingDeg), p1 = rad(lat), l1 = rad(lon);
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(br));
    const l2 = l1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return [deg(p2), ((deg(l2) + 540) % 360) - 180];
  }
  function haversine(a1, o1, a2, o2) {
    const dp = rad(a2 - a1), dl = rad(o2 - o1);
    const x = Math.sin(dp / 2) ** 2 + Math.cos(rad(a1)) * Math.cos(rad(a2)) * Math.sin(dl / 2) ** 2;
    return 2 * R_EARTH * Math.asin(sqrt(x));
  }

  /* ---------------------------------------------------------- reference set */
  const REFERENCES = [
    { kt: 0.015, name: 'A large conventional bomb (15 t)' },
    { kt: 0.3,   name: 'Smallest B61-12 setting' },
    { kt: 15,    name: 'Hiroshima — "Little Boy"' },
    { kt: 21,    name: 'Nagasaki — "Fat Man"' },
    { kt: 50,    name: 'Largest B61-12 setting' },
    { kt: 100,   name: 'A typical Trident W76' },
    { kt: 300,   name: 'A US Minuteman W87' },
    { kt: 455,   name: 'A US Trident W88' },
    { kt: 800,   name: 'A Russian Yars warhead' },
    { kt: 1200,  name: 'US B83 — the largest still in service' },
    { kt: 5000,  name: 'A Chinese DF-5B warhead' },
    { kt: 15000, name: 'Castle Bravo — the largest US test' },
    { kt: 50000, name: 'Tsar Bomba — the largest ever detonated' },
  ];
  /* Non-nuclear anchors, so the numbers attach to something people have seen. */
  const ANCHORS = [
    { kt: 0.011, name: 'the MOAB, the largest conventional US bomb' },
    { kt: 0.5,   name: 'the 2020 Beirut port explosion' },
    { kt: 2.9,   name: 'the 1917 Halifax explosion — the largest accidental blast before the bomb' },
    { kt: 15,    name: 'Hiroshima' },
  ];
  function nearestReference(kt) {
    let best = REFERENCES[0], bd = Infinity;
    for (const r of REFERENCES) { const d = Math.abs(Math.log(r.kt) - Math.log(kt)); if (d < bd) { bd = d; best = r; } }
    return { ref: best, ratio: kt / best.kt };
  }
  const hiroshimas = kt => kt / 15;
  /* Equivalent megatonnage — the better measure of destroyed AREA, because area
     scales as Y^(2/3), not Y. */
  const emt = kt => pow(kt / 1000, 2 / 3);

  /* A plain-language paragraph describing the current scenario — the
     screen-reader equivalent of the map, and useful to anyone who would rather
     read than squint. */
  function narrate(eff, place, cas) {
    const g = k => { const r = eff.rings.find(x => x.key === k); return r ? r.km : null; };
    const km = v => v == null ? '' : (v >= 10 ? v.toFixed(0) + ' kilometres' : v >= 1 ? v.toFixed(1) + ' kilometres' : (v * 1000).toFixed(0) + ' metres');
    const Y = eff.yieldKt;
    let s = `A ${Y >= 1000 ? (Y / 1000) + ' megaton' : Y + ' kiloton'} ${eff.burst === 'air' ? 'airburst' : 'ground burst'}`;
    s += place ? ` over ${place}. ` : '. ';
    s += `That is ${(Y / 15).toFixed(Y / 15 >= 10 ? 0 : 1)} times the Hiroshima bomb. `;
    if (g('psi20')) s += `Buildings are destroyed out to ${km(g('psi20'))} from the centre, and homes collapse out to ${km(g('psi5'))}. `;
    else if (g('psi5')) s += `Homes collapse out to ${km(g('psi5'))} from the centre. `;
    if (g('burn3')) s += `Anyone outdoors within ${km(g('burn3'))} suffers third-degree burns. `;
    if (g('psi1')) s += `Windows break as far out as ${km(g('psi1'))}. `;
    if (eff.heatOutrunsBlast) s += `The heat reaches ${eff.heatVsBlast.toFixed(1)} times further than the zone where homes collapse — fire, not pressure, sets the scale of the disaster. `;
    if (cas && cas.cityPop) s += `Somewhere between ${Math.round(cas.deadRange.lo / 1000)} and ${Math.round(cas.deadRange.hi / 1000)} thousand people would be killed, with a similar number or more injured. `;
    if (eff.fallout && eff.fallout.length) s += `Fallout would be carried downwind, with dangerous dose rates up to ${Math.round(eff.fallout[eff.fallout.length - 1].downwindKm)} kilometres away depending on the wind. `;
    return s.trim();
  }

  /* ------------------------------------------------------------ self-check */
  function selfTest(expected) {
    const rows = expected || root.NUKE_PHYSICS_CHECKS;
    if (!rows || !rows.length) return null;
    const out = [];
    for (const r of rows) {
      /* The published check values assume each blast ring sits at its own
         optimum burst height, so compare against that rather than against the
         single height the map draws. */
      const surface = /surf/i.test(r.burst || '');
      const cmp = (k, want, got) => {
        if (want == null || got == null) return null;
        const err = Math.abs(got - want) / want;
        return { k, want, got: +got.toFixed(3), err: +(err * 100).toFixed(1), ok: err < 0.12 };
      };
      /* Some published rows fix an explicit burst height ("..._580m"); those
         exercise the height model rather than the per-ring optimum. */
      const explicit = /_(\d+)m\b/.exec(r.burst || '');
      const hob = surface ? 0 : explicit ? Number(explicit[1]) : null;
      const psiAt = psi => (hob == null ? COEF.blast[psi].air * cbrt(r.yieldKt) : blastRadius(r.yieldKt, psi, hob));
      const thermAt = () => {
        const slant = dualLaw(COEF.thermal.burn3, r.yieldKt) * (surface ? COEF.thermal.surfaceFactor : 1);
        return hob ? sqrt(Math.max(0, slant * slant - (hob / 1000) ** 2)) : slant;
      };
      const checks = [
        cmp('fireball', r.fireballKm, fireballRadius(r.yieldKt, surface ? 0 : 1)),
        cmp('psi20', r.psi20Km, psiAt(20)),
        cmp('psi5', r.psi5Km, psiAt(5)),
        cmp('psi1', r.psi1Km, psiAt(1)),
        cmp('burn3', r.burn3Km, thermAt()),
      ].filter(Boolean);
      out.push({ yieldKt: r.yieldKt, burst: r.burst || 'air', checks });
    }
    const bad = out.flatMap(o => o.checks.filter(c => !c.ok)
      .map(c => `${o.yieldKt}kt ${o.burst} ${c.k}: got ${c.got}, expected ${c.want} (${c.err}% off)`));
    if (bad.length) console.warn('[physics] outside 12% tolerance:\n' + bad.join('\n'));
    return out;
  }

  root.NukePhysics = {
    COEF, RINGS, REFERENCES, ANCHORS, RURAL_DENSITY,
    effects, blastRadius, fireballRadius, thermalRadius, radiationRadius, crater,
    falloutContour, doseRateAt, blastArrivalSeconds, thermalPulseSeconds,
    defaultHob, optimumHob, maxHob, falloutFreeHeight, resolveHob,
    cityProfile, densityAt, popWithin, casualties, narrate,
    destination, haversine, nearestReference, hiroshimas, emt, selfTest,
  };
})(window);
