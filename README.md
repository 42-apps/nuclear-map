# Global Nuclear Weapons Map

An interactive globe of every nuclear weapon on Earth: **who has them, how many, where they are physically
kept, what they would do — and how the arsenals rose and fell from 1938 to 2026.**

**Live:** https://42-apps.github.io/nuclear-map/

---

## What it shows

| | |
|---|---|
| **Countries** | Coloured by nuclear status, warhead count, total megatonnage, democracy score, tests conducted, when they got the bomb, warheads per head of population, or treaty commitments. |
| **Sites** | Every publicly documented silo field, submarine base, bomber base, warhead store, enrichment plant, reprocessing line, weapons lab and test site — with real coordinates. |
| **Colour = certainty** | 🟢 declared arsenal · 🟡 undeclared but universally assessed (Israel) · 🔴 pursuing or threshold (Iran) · 🔵 hosting another state's weapons · 🟣 built the bomb and gave it up (South Africa, Ukraine, Kazakhstan, Belarus). |
| **Shape = kind of site** | ● deployed weapons · ■ storage · ◆ making the bomb · ▲ test site · ○ former/dismantled. |
| **Owner flags** | Where one country's weapons sit on another's soil — US B61s at Incirlik, Kleine Brogel, Büchel, Ghedi, Aviano, Volkel and Lakenheath; Russian weapons at Asipovichy in Belarus — the marker flies the **owner's** flag, because those warheads are not the host's. |
| **Megatonnage badges** | A 💥 sized by each country's total explosive yield, so you can see at a glance who holds the most destructive power — not just the most warheads. |
| **Timeline** | Scrub or play 1938 → 2026. Watch the stockpiles climb past 70,000 warheads in 1986 and fall back, South Africa's six bombs appear in 1979 and vanish in 1991, and Ukraine's inherited arsenal go home to Russia. |
| **Detonation simulator** | Standard published effect radii for any warhead on any city — fireball, blast, burns, prompt radiation, fallout plume, crater, casualty ranges, shockwave arrival times. Or place a country's **entire arsenal** on the world's largest cities. |
| **Reach rings** | How far each state's missiles actually get, drawn from where the arsenal really sits. |

Also inside: every nuclear test ever conducted, the treaty architecture and where it stands in 2026, the
Doomsday Clock's full history, and the human record — Hiroshima, Nagasaki, the Marshall Islands,
Semipalatinsk, Maralinga, Polynesia.

## Nothing here is secret

Every location, number and figure comes from published open sources: the **Federation of American
Scientists**' Nuclear Notebook and Status of World Nuclear Forces, the **Bulletin of the Atomic Scientists**,
**SIPRI**, the **Arms Control Association**, the **IAEA**, the **Nuclear Threat Initiative**, the
**International Panel on Fissile Materials**, **CSIS Beyond Parallel** and commercially available satellite
imagery. Most of these sites are photographed from orbit every day.

Warhead counts are **independent analysts' estimates**, not official declarations — most nuclear-armed states
publish little or nothing. Where sources disagree, the map says so, and every site carries a confidence
rating.

The effects simulator implements the standard unclassified scaling equations from *The Effects of Nuclear
Weapons* (Glasstone & Dolan, US Government Printing Office, public domain). It is an educational tool. It is
not suitable for emergency planning or emergency response, and it is not a perfect simulation.

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

The merge tool normalises every site record, deduplicates by coordinate, applies the coordinate and number
corrections from the verification pass, derives the "armed from / armed to" windows from the warhead time
series, and writes `data/nuclear-data.js`, `data/sites.js`, `data/history.js` and `data/cities.js`.

## Layout

```
index.html          the whole app
nuclear.css         theme + layout
nuclear.js          globe, flat map, layers, timeline, cards, search
physics.js          nuclear effects — clean-room from Glasstone & Dolan
blast.js            the detonation simulator UI
data/               generated data + Natural Earth country borders
lib/globe.gl.min.js bundled, no CDN
tools/              merge tool + local static server
```

No build step, no dependencies, no network calls at runtime. Everything is bundled.

## Corrections

Data errors are likely in a project this size, and corrections are genuinely welcome — open an issue with a
source.

---

Part of [42-apps](https://42-apps.github.io/).
