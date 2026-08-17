# CHANGELOG

> **Version renumber (at 1.2.0).** 1.2.0 is the FIRST PUBLIC RELEASE. All
> earlier development versions were renumbered to 0.3.0–0.12.0 in release order
> (old 0.1.0→0.3.0 … old 1.7.0→0.12.0); the full mapping lives in the
> version-library README. Entries below keep their original content; their old
> numbers are shown with the new number in front.

## 1.2.0 — smooth bodies, one shading pass, saturation measured

Stage cards
- **HIGH gains a fifth colour norm — `saturation_area`, band 10%–34%**: the share of the view whose colour carries HSV saturation ≥ 0.50, measured on the UNLIT baked vertex colour so brightness, AO and lighting cannot skew it. Below the floor the creature reads as a grey mass; above the ceiling saturation stops working as a spotlight. It rules AMOUNT, never LOCATION — the designer picks which surfaces carry the colour. The reshipped wolf measures 26.0%; the previous wolf measured 0.2% and would fail. The accent norm now reads as a cap on the ACCENT alone (<5%), not on total saturated area.
- **MID's fold-and-carve vocabulary no longer offers `faceted` for masses**: concave sections, `sharp` profile rows and a lower per-volume `smooth_angle` instead; parts may still be faceted freely.
- SYNTAX.md gains `shading`, `smooth_angle` and `build`, marks `faceted` parts-only, and drops `colors.gradient`/`colors.noise` from the volume example. 04_SHIP's gate.json example lists `faceted_body` and `saturation_area`.

Engine
- **Vertex normals are ANGLE-weighted and carry a smoothing angle** — `smooth_angle`, spec-level default 50, overridable per volume and per part. Faces meeting at a vertex average when their normals sit within the angle; the vertex is duplicated only where it genuinely carries two smoothing groups, so creases cost a handful of vertices instead of tripling the mesh. `"faceted": true` is now exactly `smooth_angle: 0`. Area weighting let one big skinny triangle drag a normal off by tens of degrees — and AO bakes from those normals.
- **`faceted: true` on a VOLUME now BLOCKs (`faceted_body`)**: two real runs came back 89% and 93% hard-edged because the model set `faceted` on the big masses; an 800-triangle torso became 800 shards, and since AO bakes from those normals the mess ships inside COLOR_0 where relighting cannot reach it. The right tools for a hard break on a body are `"sharp": true` on the profile row or a lower `smooth_angle` on that volume. Escape hatch for robots, constructs, golems and vehicles: `"build": "rigid"` at spec level. Parts (fin/spike/curve/paw/membrane) may still be faceted freely.
- **Shading moved from per-volume to spec-level**: `"shading": {"gradient":{"top":0.30,"bottom":-0.88}, "noise":{"size":0.018,"amount":0.26}}` (the defaults). The ramp is measured over the WHOLE body's Y range and applied to EVERY mesh — volumes, paws, ears, eyes, horns. Each volume used to ramp over its own bbox, so the same numbers meant different things on an upright leg and a horizontal torso (the old wolf wrote bottom -0.16 on legs and -0.04 on the torso to fake one consistent light), and parts received no shading at all, so paws read as stickers. `noise.size` is a FRACTION OF THE MODEL DIAGONAL, not an absolute distance: an absolute cell keeps its world size as the creature scales, so the same spec on a 5x larger creature produced grain finer than the vertex spacing and aliased into banding. `colors.arcs` stays per volume; `colors.gradient`/`colors.noise` are ignored and emit an `info:` line.
- **Gamma bug fixed**: `hex2lin` in compile.js applies the sRGB transfer function, as ao.js and glb.js always did. Before, any volume with a `colors` block shipped about 1.5x too bright with its value steps collapsed — the wolf's spine-band-to-base contrast fell from 5.3x to 2.1x, so the arc bands were effectively invisible.
- **AO defaults retuned**: samples 14 → 16, strength 0.75 → 0.59, radius 0.35 → 0.60 of the model diagonal. One AO pass only; there is no second crevice pass and none is planned.

Harness & fixes
- **`saturation_area` claim** in judge.mjs — `{"type":"saturation_area","view":"tq","min":0.14,"max":0.34}` — added at stage HIGH to all three role presets (minion/npc/boss) and to `specs/_TEMPLATE.json`.
- `setup.sh` installs scipy: harness/maskmetrics.py imports `scipy.ndimage`, and setup used to print "calibrate OK" then blow up mid-LOW.
- `proportion` decides limb exemption from `spec.mirror` instead of the chain name's first letter — renaming a chain "axis" to "Laxis" used to bypass the 50:50 ruler entirely.
- example/README.md rewritten accurate: the wolf is the reference example (high-saturation area 26.0%), not a copy of the `templates/` anchor removed in 1.2.0, and it ships with UV off.

## 1.2.0 — first public release: MID/HIGH doctrine + Gobkit delivery

Stage cards
- **MID = whitelist part blind-reads, identity only**: face (always) + signature part + order-named parts are rendered ALONE (`qa_isolate` builds) and shown 4-view to a context-free reader with one question — "what is this?" A face that reads as "a ball" fails. Edit vocabulary: swap local shapes / fold-carve / bend the pose (elbows are MID); no naked sphere/cube/cone on whitelisted parts. Silhouette share demoted to a budget check.
- **HIGH = free colour under four norms** (one high-sat main on the signature, one secondary, accent <5%, brightness floor measured on the render) + three animations always (idle/move/attack).
- **04_SHIP (new card)**: gate stamp (real results only) → name + signature questions (ownership first; signature remembered in ~/.anyCreature.json) → scripted delivery → the share ask LAST, CC0 in one sentence → publish only on an explicit yes. Never auto-upload, never background, ask every time.

Engine
- **Per-vertex AO bakes at compile** into COLOR_0 (hemisphere rays, grid-accelerated, deterministic) — the "solid" look ships in the file; `"ao":false` is debug-only.
- **`attack_reach` check**: attack clips must drive some part ≥ half the body span past the bind front or the build BLOCKs — kills the in-place-wave class.
- **`touch` declarations**: chains declared connected must overlap or BLOCK (the floating-snake-body class).
- **`part_overlap` warn**: measures gross part-into-part interpenetration (the self-intersecting-fist class) — a measure, not a law.
- **`joints_R` pose overrides**: mirrored pairs grow symmetric, bind pose staggers; the mirrored skin follows its joints.
- **Public bone naming**: exported limb bones follow `^[LR][A-Z][A-Za-z]*\d+[A-Z][a-z]$` (LArm1Sh, RFrontLeg1Kn) natively — no `.l/.r` suffixes, no rename pass; mesh `creature`, skin `creature_rig`; internal spec names never leak.
- **Primitive merge**: one primitive + one material per palette entry (kills the 67-material class from mirrored parts) — semantic part names survive as material names.
- **UV atlas now opt-in** (`keep_uv`): without textures TEXCOORD_0 was dead weight; AO no longer needs it.
- Language cleanup: part types settled on `curve` and `membrane`, and the surface-snapping switch on anchored parts settled on `conform`.
- Harness stamp in `asset`: generator `anyCreature v1.2.0`, `extras.harness/.harness_version/.spec`; delivery adds `extras.monster` + `asset.copyright` (user's name + signature travel INSIDE the file); publish adds `extras.license: CC0-1.0` at consent time.

Engine correctness — the "invisible until a human looks" class
- **`part_attachment` (new BLOCK): parts were never checked for being attached to
  anything.** `root_containment` walks `spec.attach`, whose candidates must carry
  both `_rings` and `chain` — curve / fin / eye / paw / spike / membrane have
  neither, so no part ever entered the loop. Real runs shipped a tusk whose whole
  root ring stood 0.031 clear of the skull, a trunk 6/15 outside, a forehead plate
  0.050 above the surface, all reported all green and all caught by eye in the most
  expensive repair round. A part must now come within 1.5% of model height of its
  host's surface. Deliberately generous: eyes and conformed plates sit ON the
  surface and pass; something hanging in the air does not. Mirrored twins are
  skipped — the source carries the verdict for both.
- **`mirror_distortion` (new BLOCK + warn): `joints_R` shears the twin instead of
  posing it.** The mirrored mesh is grown along the LEFT bone path and then dragged
  onto the right joints by weighted TRANSLATION, so a large offset squashes the
  volume. Measured on the wolf: offsets up to 10% of limb length are clean, 16%
  costs 12% of a dimension, 24% costs 19%, 39% costs 31% and blocks. A reported
  case had a right thigh 0.152 deep against 0.381 on the left with its width intact
  — invisible from the left, invisible in the log. Warn past 12% deviation, BLOCK
  past 30%. Doctrine added to SYNTAX and MID: `joints_R` is for a few centimetres
  of stagger; a genuinely different pose belongs in its own chain outside `mirror`.
- **`attack_reach` no longer demands a whole-body lunge.** It required half a body
  span PAST the bind front, which rejected every stand-and-swing design. Now either
  route passes: REACH (≥15% of span past the front) or SWING (a part travels forward
  ≥45% of ITS OWN length — the limb's travel is bounded by the limb, not the body;
  the old rule was a dimensional error). Verified: ±20° twitch blocked, ±35° foreleg
  swing passes, forward tail slam passes, sideways sweep blocked, full lunge passes.
- **`anim_integrity` says WHERE.** It is ~83% of all blocks in practice and used to
  report only `"move" @0.5 folds mesh (10 flipped tris)`, forcing a binary search.
  It now names the worst mesh for folds, and the mesh plus the driving joint for
  stretches, with the three fixes that actually apply.
- **Profile-slope warning at compile.** Scaling a volume without scaling `ring_step`
  crowds rings relative to how fast the radius changes; past a slope of ~0.8 the
  next bend flips triangles. The engine now warns with the number and the location,
  instead of letting it surface later as flipped tris during an animation.
- **Anchored parts narrate the world direction they actually face.** `around` is
  read in the host section's frame; the documented 0=spine / 90=side / 180=belly is
  the BODY chain's frame. Measured on a leg: 0=inner, 90=FRONT, 180=OUTER, 270=back
  — so a plate aimed at the outside of a thigh with 90 silently lands on its front.
- **`deliver.py` refuses a self-contradicting gate stamp.** A delivered model was
  found carrying `"passed": true` with `mid_face_blindread` failed in the same
  object, and it had already been published. The stamp travels inside the GLB
  forever; delivery now stops unless the aggregate matches the checks.

Security & open-sourcing
- **Arbitrary file read in `judge.mjs` closed (the one real vulnerability).** The
  static handler did `path.join(base, urlPath)` with no containment check, and the
  listener bound to `0.0.0.0`. A raw request line carrying `/../../../../etc/passwd`
  (a socket does not normalise it the way `fetch` does) escaped every base and the
  file was served — `/proc/self/environ` included, which is where credentials live.
  Any host on the same network could read any file, for as long as a judge run
  lasted. Now: resolve then require containment, serve only `.js .mjs .map .json
  .wasm`, and listen on `127.0.0.1`.
- **`silmetrics.mjs` and `hero.mjs` bind to `127.0.0.1` on an OS-assigned port**
  instead of `0.0.0.0:8961` / `0.0.0.0:8963`. Their handlers were already
  whitelisted so nothing leaked beyond the model, but the pages and models were
  network-visible during a run, and two concurrent runs collided on the port.
- **Creature names and signatures are HTML-escaped** before they go into the
  delivered viewer (`deliver.py`). A creature named `</h1><script>…` executed in
  the page; the same string also rides in the GLB to the community wall, so
  SECURITY.md states plainly that the server must escape it independently too.
- **Chromium keeps its OS sandbox.** `--no-sandbox` was unconditional in
  `judge.mjs`; it is now opt-in via `PW_NO_SANDBOX=1`. The hardcoded
  `/opt/pw-browsers/chromium` path is gone from all three render tools — Playwright
  locates its own browser, `PW_CHROMIUM_PATH` pins one. That path made every clone
  fail on macOS and Windows.
- **Licensing corrected.** MANUAL claimed "no third-party code is bundled"; it does
  bundle three.js (MIT) as `harness/assets/three-bundle.js`. The upstream notice was
  always preserved in the file, so nothing was ever out of compliance — the sentence
  was simply wrong. Added `THIRD-PARTY-NOTICES.md` with the full MIT text plus the
  licences of everything `setup.sh` installs.
- **Added `LICENSE` (MIT, © 2026 Alsomind Tech Co., Ltd.), `README.md`, `SECURITY.md` and `.gitignore`**; `gobkit.json`'s `_key_label` now says
  the key is public by design and that rotation cannot retract what is already in
  git history.

Delivery & publish
- **Showroom viewer redesigned and moved out of the Python** into
  `harness/assets/showroom.html` (placeholders `__TITLE__` `__BYLINE__`
  `__BUNDLE__` `__B64__`), so the room can be restyled without touching
  `deliver.py`. Gallery room: radial backdrop, floor wash, vignette, a
  small-caps name plate reading `<signature> · anyCreature <version>`, and three
  tool buttons — cycle the file's own animation clips, turntable, hard-edge clay
  with a wireframe overlay. Shadow-casting key light over a ShadowMaterial
  ground; camera auto-framed to the bounding sphere and the model rested on the
  floor. Fully offline: three.js inlined, model base64'd, no CDN and no webfont
  (system serif stack) — double-click and it runs.
- **`publish.mjs`: try the upload, always.** New doctrine written into the
  script header and card 04 — never pre-judge the environment as offline.
  Cloud sandboxes and Cowork sessions frequently do have egress; run the command
  and answer from what it prints. Saying "in a sandbox you can only upload by
  hand" without attempting is now explicitly wrong.
- **`offline` renamed to `blocked`, and 403 is classified as network filtering,
  not a key problem.** The submit endpoint always answers in JSON, so an HTTP
  403 or any non-JSON body means an intermediary replied — a proxy, captive
  portal or corporate filter. `blocked` is a normal outcome, reported as the
  next step ("the pack is ready, drag it into the page") rather than an error.
  Nothing tells the user to fetch or change a key.
- **hero.png is now required in practice**: a submission without a thumbnail is
  accepted but never lists automatically — it waits for a human reviewer, and
  that is the one common post-upload stall. `publish.mjs` warns loudly when the
  file is missing and reports `thumb` in its JSON line.

- `deliver.py` v2: stamped GLB + showroom viewer (studio backdrop, title card, animation pills) + `hero.mjs` auto-framed hero.png (1024² transparent 45°, ≥8% margins, idle mid-frame) / hero.jpg + backup upload pack.
- `publish.mjs`: multipart POST to gobkit.com/api/community (fields model/thumb/title/creator_name/channel/key) with three scripted outcomes — published (echo the SERVER's title/creator + share link), pending_review (one calm line), offline (backup path: drag delivery/upload/creature.glb into gobkit.com/community/upload).

## 0.12.0 (was 1.7.0) — clean painter, strict inspector (validated by 7 head-to-head experiments)

Architecture (from the harness-vs-native duels and the 2x2/gryphon experiments)
- **Creation side stripped to a pit-map**: no design doctrine upfront — free design won or tied every duel where part character mattered; doctrine text taxed boldness. Design knowledge now lives in gates and rulers only.
- **Two gates, four views each, read by context-free agents** (self-grading shipped the worst failure in project history): Gate 1 RECOGNISED — any stick/slab view kills; Gate 2 PUNCHIER — after identity passes, rounds may only exaggerate, judged prev-vs-curr; compliance-only edits forbidden. LOW's deliverable is an exaggerated silhouette.
- **Stop-loss**: same symptom failed twice → concept restart, never a third tweak (verdict-driven micro-repair oscillated: human→bell, trousers→rooster).
- **Signature parts get real geometry at LOW** (a fist is fingers and knuckles, not a sphere); 6:3:1 governs geometry budget, not just screen share.
- Scale calibration: 24px = feel, 48px = identity (control reads on the approved standard proved single-scale gates miscalibrated). Front view alone may be symmetric; paired features still stagger.
- Templates removed entirely (anchor became a topology prison — a giant order produced a wolf skeleton).

Engine wave-1 (~+250 lines; required reading stays ~1 page)
- `curve`: curved horns/tusks/trunks — per-segment steering that accumulates down the chain (`rise`/`fall`/`ahead`/`behind`/`coil`); the mammoth-tusk class of failure was a vocabulary gap, not a design gap.
- `membrane`: skin between rib chains with blend skinning, a scooped trailing edge, and the root-gap warning — the bat-wing failure class, where a shape that never encloses reads as spread fingers.
- Named sections incl. CONCAVE outlines (`"sections"`): bark flutes, crescents — relief is geometry.
- `faceted` hard-edge shading; anchored parts snap onto the host surface normal by default (`conform:false` opts out).
- Compiler narration: `info:` lines report the accumulated bend of a curve and how far a plate was rotated to meet its surface.
- Membranes exempt from the closed-surface fold check (saddle regions are legitimate).
- maskmetrics dullness flags: `sq_fill` (1:1-frame volume), `mirror_sym`, `straight_max` (plank detector) — measures only, judgment stays with the reader/LLM.

## 0.11.0 (was 1.6.0) — method over conclusions (cards + silmetrics)

Constitutional rule added: **cards carry method and rulers, never instance conclusions** — a specific creature's ratio numbers or 24px phrases are per-order products; baking them in anchors every future creature to one answer and pollutes context. Accordingly:
- Ratio table (design 2c) rewritten method-only: the session decomposes the order's creature-noun itself — picks WHICH 3–5 ratios carry the identity, justifies each against the temperament. The giant's worked numbers are gone.
- New general art direction: **ratios checked in all three orthographic views** (one-view drama = cardboard); **per-axis decomposition** (a mass's elongation axis is identity information); **colour philosophy** in HIGH (value-first 70/25/5, saturation as spotlight, one temperature story, pattern follows form).
- silmetrics now renders **side + front + top** and reports per-view aspect/fill.
- Instance residue swept from 1.5.0's cards (giant example lines, magic numbers).

## 0.10.0 (was 1.5.0) — doctrine patch: the giant lessons (cards only; engine unchanged from 1.4.0)

Distilled from an approved no-harness mountain-giant build — the reasoning that made it work, sedimented into the cards:
- **Ratio table** (design 2c): the identity noun translates DIRECTLY into a mass-allocation table vs a baseline; scaling up ≠ giant, changed ratios = giant. The exaggeration vector is the table's extreme rows.
- **Three contour layers** (LOWRES): primary masses (3–5, = 80% of silhouette, verified FIRST) → breakers (straight lines & sharp angles on the contour) → details. Order never reverses.
- **Blob-pile trap + the glue**: elongate ~1.7×, overlap seams, and the decisive fix — a hard plate spanning ≥2 masses fuses them into one structure (why pauldrons span shoulder+arm).
- **Negative space, pose, curve-vs-hard coexistence** added to the silhouette declarations; **≥3 read points** and a ~15° asymmetry nudge added to the stage-1 human checklist.

## 0.9.0 (was 1.4.0) — the big-form release (core competence: silhouette tension)

Engine
- **Relational joints**: `{"from":X,"fwd/up/side":d}`, `{"from":X,"dir":[..],"len":d}`, `"ground":y` for feet — specs think in proportions again; absolute coords stay legal. Verified bit-identical against the absolute wolf spec.
- **Game-ready UVs**: automatic unwrap (cylindrical tubes + planar caps, box unwrap for parts), seam-vertex duplication, one non-overlapping world-density atlas (`TEXCOORD_0`); overlap audit 0.2% (corner texels only) → AO/lightmap bakeable.
- Fixed inverted normals in `paw` (winding) and `fin` (outline now canonicalised CCW, rim rewound).
- Fixed floating surface anchors (eyes/ears): lookup by true arc-length `ringT` instead of ring index (bevel-skip had shifted indices).
- `proportion` gate aligned to the styling rule: 0.96 → **0.923** (the 0.92–0.96 blind band caught nothing); minor-segment filter now relative to mean segment length (checks 6–7 pairs on a 9-joint spine, was 1).
- `limb_clearance` exposed-test gets a 5% seam tolerance (groin-seam verts are host geometry, not exposed limbs).
- Wolf: head split into its own volume (rooted inside the neck), slab thighs (`exp` 2.2–2.6), eyes moved to the head's side (`around` 62).

Harness
- **silmetrics.mjs**: side+front silhouettes, 24px thumbnail, and the numbers — `W_over_H, fill, mass_thirds, torso_depth, mass_contrast, leg_fraction, turn_count, zigzag_alignment, iou_vs_prev`.
- Calibration: green = the bred wolf; red = legacy broken wolf **plus** `red_5050.json`, which violates ONLY the 50:50 rule — proving that specific ruler bites.

Doctrine (cards, all-English rewrite)
- 24px contract (identity phrase / per-part features / signature survival) + blind-read gate with recall scoring and signature veto.
- Exaggeration vector + character axes: declared tension, verified by the loop; floors-are-not-goals iron law.
- Knob table (symptom → spec knob) distilled from the wolf's measured convergence.
- `templates/` library with breeding pipeline: in-house references only, human sign-off mandatory; ships `quadruped_light`.
- Docs/cards no longer reference the retired pre-0.8 spec language or its tooling; syntax quick-refs show the real JSON.

## 0.8.0 (was 1.2.0) — engine swap: original ACS engine v2 (author Ariescar, zero foreign code), six built-in checks, JSON spec, wolf example.
## 0.7.0 (was 1.2.0) — one-shot pipeline for non-designers: 2-question interview, 3/2/1 rounds, five stage cards, staged judging, scripted delivery.
## 0.6.0 (was 1.1.0) — engine renamed ACS; two quantified claims added; 10-round budget.
## 0.5.0 (was 1.0.0) — generic engine + styling rules + embedded compiler + example + manual.
## 0.4.0 (was 0.2.0) — engine/spec split, generic harness.
## 0.3.0 (was 0.1.0) — first two gates, dragon-specific thresholds.
