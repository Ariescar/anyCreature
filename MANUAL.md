# anyCreature 1.2.0 — text → game-ready 3D creature, one shot

Author: **Ariescar**. The engine and the harness scripts are original work. One third-party component IS bundled: `harness/assets/three-bundle.js` is a build of three.js (MIT, © 2010-2025 Three.js Authors) used by the render tools and the delivered showroom — its licence notice travels in the file and in `THIRD-PARTY-NOTICES.md`. Everything else npm installs at setup time. Licence: MIT (`LICENSE`); third-party attributions in `THIRD-PARTY-NOTICES.md`.

A session receives an order like "make me a menacing mountain giant", asks at most
2 questions, and delivers a skinned, animated, vertex-coloured, **AO-baked GLB**
plus an offline showroom viewer — and, with the user's explicit yes, publishes it
to the Gobkit community under CC0.

## Quickstart for the executing session

```bash
bash setup.sh                      # deps + red/green ruler calibration (must print "calibrate OK")
# then read cards/ in order: 00_START → 01_LOW → 02_MID → 03_HIGH → 04_SHIP  (SYNTAX.md when building)
```

Pipeline: interview (≤2Q) → silhouette brief → **LOW: design free + two gates** →
MID (2 rounds, whitelist part blind-reads) → HIGH (1 round, colour + 3 animations)
→ SHIP (scripted delivery, closing dialogue, optional publish).

## The doctrine in one paragraph

Head-to-head experiments showed the model designs BOLDLY when left free, and every
attempt to teach it design upfront made the output tamer — so this harness ships a
**clean painter and a strict inspector**: the creation side gets only the order, the
engine syntax, and a short pit-map of engine-local traps; ALL quality control lives
in gates read by context-free reader agents (never self-graded). Gate 1: all four
views RECOGNISED. Gate 2: rounds may only make the silhouette BOLDER — LOW's
deliverable is an exaggerated silhouette, not a correct one. MID blind-reads the
whitelisted parts (face, signature, order-named) with one question: what is this?
Same symptom failed twice = concept restart, never a third tweak. Form beats
obedience, everywhere.

## Folder map (accurate — trust this over memory)

```
MANUAL.md            this file
README.md            repository front page (humans)
LICENSE              MIT
THIRD-PARTY-NOTICES.md  bundled + installed dependency licences
SECURITY.md          local servers, the public key, untrusted input
VERSION              1.2.0
setup.sh             deps + calibration self-check
cards/               00_START · 01_LOW · 02_MID · 03_HIGH · 04_SHIP · SYNTAX.md
engine/              cli.js + core/ — the ACS engine v2
  core/normals.js    angle-weighted normals + `smooth_angle` creases (bodies stay smooth)
harness/
  silmetrics.mjs     4-view silhouettes (front/side/top/hero45) + numbers + 24/48px thumbs
  maskmetrics.py     per-view measures + dullness flags (sq_fill / mirror_sym / straight_max)
  judge.mjs          claims judge (part shares, focal contrast, styles, saturated area, rig/anim/tri)
  deliver.py         stamped GLB + showroom viewer + hero shots + backup upload pack
  hero.mjs           hero.png (1024² transparent 45°) + hero.jpg (studio grey)
  publish.mjs        Gobkit publisher — ONLY after the user's explicit yes (card 04).
                     ALWAYS attempt the upload; the drag-and-drop page is the
                     fallback for a `blocked` result, never the opening move
  gobkit.json        endpoint + release key for publish.mjs
  presets/           role QC presets (minion/npc/boss)
  assets/            three-bundle.js for the render tools
calibration/         wolf_green (must build) · wolf_red + red_5050 (must be blocked)
example/             wolf.json + wolf.glb — a bred, approved light quadruped
```

## The engine in seven lines

- ONE JSON spec: relational joints, chains, mirrored twins (+`joints_R` staggered
  pose), tube volumes with profile rows (superellipse / **named concave sections**),
  `sharp` breaks, per-volume colour arcs, keyframe animations, `touch` connection
  declarations.
- Parts: `curve` (bending horns/tusks/trunks), `membrane` (wings, frills, sails —
  close the outline back to the body or the compiler warns), `fin` (plates,
  conforming onto surfaces by default), `eye`, `paw`, `spike`.
- Normals carry a smoothing angle (`core/normals.js`, default `smooth_angle` 50,
  per volume/part): faces within the angle average, vertices split only at real
  creases. `faceted` on a VOLUME is a BLOCK (`faceted_body`) — bodies break with
  `sharp` rows; `"build":"rigid"` is the escape hatch for machines.
- ONE spec-level `shading` pass — value ramp over the whole body's Y range plus
  grain sized as a fraction of the model diagonal, on every mesh, parts included —
  then **per-vertex AO bakes at compile** into COLOR_0: the solid look ships in
  the file.
- Blocking checks incl. `attack_reach` (an attack must lunge half a body span);
  `warn:` measures (part overlap) are yours to judge; refused builds cost no
  round. The compiler also NARRATES (`info:` lines) — where a curve really bent,
  how far a plate conformed. Free QC; read it.
- Shipped GLBs: primitives merged per material, public bone names (`LArm1Sh`
  convention), mesh `creature` / skin `creature_rig`, harness stamp in `asset`.
- `node engine/cli.js spec.json out.glb` — that's the whole interface.

## Scale discipline

24px reads FEEL (heavy/fast/sharp); 48px reads IDENTITY (what creature). Judge each
at its own scale. Only the FRONT view may be left-right symmetric — and paired
features (four wings) still stagger. Model-level looks are the final judge.

## Delivery & publish

Card 04 is the whole flow: gate stamp → name + signature questions (once;
`~/.anyCreature.json` remembers the signature) → `deliver.py` (stamped GLB,
offline showroom viewer, hero shots, backup upload pack) → the share ask LAST →
`publish.mjs` only on an explicit yes — and then RUN it, never assume the
environment is offline. hero.png must be attached or the listing waits for a
human reviewer. CC0 is stamped at consent time, not before.

## Versioning

Semver; old zips never change; every release adds a CHANGELOG entry and a README
row. (1.2.0 is the first public release — earlier development history was
renumbered 0.3.0–0.12.0; the mapping lives in the version-library README.)
