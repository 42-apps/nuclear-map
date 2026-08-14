# Global Nuclear Weapons Map

An interactive globe of every nuclear weapon on Earth: **who has them, how many, where they are physically
kept, what they would do — and how the arsenals rose and fell from 1938 to 2026.**

**Live:** https://42-apps.github.io/nuclear-map/

---

## What it shows

| | |
|---|---|
| **Countries** | Coloured by nuclear status, warhead count, total megatonnage, democracy score, tests conducted, when they got the bomb, warheads per head of population, or treaty commitments. |
| **Sites** | **633 mapped sites, 609 with real coordinates**, across **55 countries** — silo fields, submarine and bomber bases, warhead stores, enrichment plants, reprocessing lines, weapons labs, uranium mines, test sites, early-warning radars and the rest of the command network, weapons lost at sea, the places the fallout landed, and former or dismantled facilities. |
| **Colour = certainty** | 🟢 declared arsenal · 🟡 undeclared but universally assessed (Israel) · 🔴 pursuing or threshold (Iran) · 🔵 hosting another state's weapons (Belgium, Germany, Italy, Netherlands, Türkiye, Belarus) · 🟣 built the bomb and gave it up (South Africa, Ukraine, Kazakhstan). Countries that ran a programme and stopped, and countries that once hosted foreign weapons, are separate categories — the distinctions matter. |
| **Shape = kind of site** | ● deployed weapons · ■ storage · ◆ making the bomb · ▲ test site · ○ warning &amp; command · ◆ lost at sea · ✚ where it landed on people · ○ former/dismantled. |
| **Owner flags** | Where one country's weapons sit on another's soil — US B61s at Incirlik, Kleine Brogel, Büchel, Ghedi, Aviano, Volkel and Lakenheath; Russian weapons at Asipovichy in Belarus — the marker flies the **owner's** flag, because those warheads are not the host's. |
| **Megatonnage badges** | A 💥 sized by each country's total explosive yield, so you can see at a glance who holds the most destructive power — not just the most warheads. |
| **Timeline** | Scrub or play 1938 → 2026. Watch military stockpiles peak at 64,452 warheads in 1986 and fall back, South Africa's six bombs appear in 1979 and vanish in 1991 — shown as an *undeclared* arsenal, which is what it was — and Ukraine's inherited weapons go home to Russia. |
| **Detonation simulator** | Standard published effect radii for any warhead on any city — fireball, blast, burns, prompt radiation, fallout plume, crater, casualty ranges, shockwave arrival times. Or place a country's **entire arsenal** on the world's largest cities. |
| **Reach rings** | How far each state's missiles actually get, drawn from where the arsenal really sits. |

Also inside: **241 timeline events**, all **2,056 nuclear tests**, **134 delivery systems**, **15 treaties** with
where each stands in 2026, national **fissile-material stockpiles**, **threshold assessments** for every state
without weapons ("how close are they?"), and a **"what we're least sure about"** panel carrying **125
uncertainties in the researchers' own words**.

## Nothing here is secret

Every location, number and figure comes from published open sources: the **Federation of American
Scientists**' Nuclear Notebook and Status of World Nuclear Forces, the **Bulletin of the Atomic Scientists**,
**SIPRI**, the **Arms Control Association**, the **IAEA**, the **Nuclear Threat Initiative**, the
**International Panel on Fissile Materials**, **CSIS Beyond Parallel** and commercially available satellite
imagery. Most of these sites are photographed from orbit every day.

Warhead counts are **independent analysts' estimates**, not official declarations — most nuclear-armed states
publish little or nothing. Where sources disagree, the map says so, and every site carries a confidence
rating.

**Two numbers get quoted and they are not the same.** The *military stockpile* is the warheads assigned to
the armed forces; the *total inventory* adds those retired but still intact. The timeline plots stockpiles,
because that is the measure published for every year back to 1945; the headline world figure is the
inventory. Both are labelled everywhere they appear rather than silently reconciled.

The effects simulator implements the scaling relations from *The Effects of Nuclear Weapons* (Glasstone &
Dolan, US Government Printing Office, 3rd edn — public domain): a two-dimensional blast model in ground range
and burst height, dual-regime thermal and prompt-radiation slant ranges, Table 9.93 fallout contours with the
effective-wind factor and t^-1.2 decay, and the DCPA/OTA casualty fractions. `tools/validate.cjs` checks the
implementation against **131 published check values** — all pass within 12%.

It is an educational tool. It is not suitable for emergency planning or emergency response, and it is not a
perfect simulation.

## Running it locally

```bash
node tools/serve.cjs . 8761
```

Then open http://127.0.0.1:8761. It needs a web server — opening `index.html` from the filesystem will fail
because the country borders are loaded with `fetch`.

## Rebuilding the data

The data files under `data/` are generated from a research dump:

```bash
node tools/nuke-merge.cjs /path/to/research-json-dir
```

The merge tool normalises every site record; deduplicates on proximity plus a name stem (researchers describe
the same place differently, and matching exact coordinates misses that); collapses consolidated files against
the parts they were assembled from; repairs coordinate sign errors only where a site is more than 500 km
outside its host country; derives the armed, hosting and programme windows; and writes `data/nuclear-data.js`,
`data/sites.js`, `data/history.js` and `data/cities.js`.

Then check it:

```bash
node tools/validate.cjs
```

which point-in-polygon-tests every coordinate against the country it claims, verifies the warhead arithmetic
adds up, and runs the physics against its published check values.

## Layout

```
index.html          the whole app
nuclear.css         theme + layout
nuclear.js          globe, flat map, layers, timeline, cards, search
physics.js          nuclear effects, from the Glasstone & Dolan tables
blast.js            the detonation simulator UI
data/               generated data + Natural Earth country borders
lib/globe.gl.min.js bundled, no CDN
tools/
  nuke-merge.cjs    research JSON -> data/
  validate.cjs      coordinate, arithmetic and physics checks
  extract-gaps.cjs  pulls the researchers' stated uncertainties out of the run
  bump.cjs          version + cache-busters
  deploy.cjs        assemble the publishable file set
  serve.cjs         local static server
```

No build step, no dependencies, no network calls at runtime. Everything is bundled.

## Corrections

Data errors are likely in a project this size, and corrections are genuinely welcome — open an issue with a
source.

---

Part of [42-apps](https://42-apps.github.io/).
