# 02 MID (budget 2 rounds | build: all parts, flat colour, ZERO new bones)

Output: every part — ears, horns, claws, eyes, fins, shell spikes, paws — riding
bones LOW already placed, or anchored to volume surfaces. No material detail, no
animation. MID's question is: **do the key parts READ as what they are?**

## The part gate — whitelist blind-reads, identity only

Not every part gets examined. The whitelist:

1. **the face — always** (if the creature has one),
2. **the signature part** (from the brief),
3. **any part the order names** ("scissor hands" → the hands).

For each whitelisted part, render it ALONE and blind-read it:

```bash
# temp spec: copy the real spec, keep only this part (+ its host chain volume
# if the part is meaningless without it), add "qa_isolate": true
node engine/cli.js out/qa_face.json out/qa_face.glb
node harness/silmetrics.mjs out/qa_face.glb out/qa_face
```

Show the four thumb48s to a context-free reader with EXACTLY this and no more:

> What is this? Answer with the name of the thing or body part you see.

Judge the verbatim answer: the part's name (or an unmistakable synonym) = pass.
**"a ball", "a blob", "an egg", "nothing" = fail** — a siren's face that reads
as a sphere has no face. Identity is the only question at MID; feel and beauty
were LOW's business, colour is HIGH's.

Two repair rounds per failed part, then iron law 3 (different concept for that
part, not a third tweak).

## Edit vocabulary (what a MID repair is allowed to be)

- **swap the local shape**: replace the primitive-ish mass with structured
  geometry — brow + muzzle + jaw instead of a head-sphere; knuckles + fingers
  instead of a fist-ball. **No naked sphere / cube / cone may remain visible
  on a whitelisted part.**
- **fold and carve**: concave sections, `sharp` profile breaks on the profile
  rows, a lower `smooth_angle` on that volume (spec default 50°), plates and
  spikes that cut the outline. **`faceted` on a VOLUME is a BLOCK**
  (`faceted_body`): it shatters an 800-triangle torso into 800 shards, and AO
  bakes that mess into COLOR_0 where no relighting can reach it. Parts — fins,
  spikes, claws, crystal, armour — may still be faceted freely.
- **bend the pose**: elbows/knees bend at MID — place the bend at its JOINT
  (`joints` positions form the bind pose). Straight arms read as dead arms.
  Mirrored pairs may stagger via `joints_R` (grow symmetric, pose asymmetric) —
  **but only by a few centimetres.** The twin's mesh is grown on the LEFT bone
  path and then translated onto the right joints, so a large offset shears the
  volume rather than posing it (a right thigh at 40% of the left's depth, width
  untouched — invisible from the left, invisible in the build log). Past ~10% of
  the limb's length it starts squashing and `mirror_distortion` warns; past ~35%
  it BLOCKs. For a genuinely different pose, take that limb OUT of `mirror` and
  author it as its own chain.

## Do (layout)

1. **Signature presence**: silhouette share is a BUDGET check — the signature
   part hits its declared share (judge measures by material name); nothing else
   needs a share test.
2. **6:3:1 lands**: geometry budget follows the hierarchy; the 6-part gets
   6-level structure.
3. **Busy-vs-calm**: on one part, one edge detailed, the other long and clean.
4. **Declared connections touch**: masses that must read as one body declare
   `"touch": [["torso","tail"]]` — the engine BLOCKS if they don't overlap.
5. **Read the warns**: `part_overlap` lines flag parts sitting inside other
   parts (the self-intersecting-fist class). A warn is a measure, not a law —
   look at the render and decide.

## Don't (blood of previous runs)

- **Mirrored inward-tilted parts cross at the midline**: length × sin(tilt) vs
  the left-right gap — do the arithmetic BEFORE placing horns/fins.
- **Parts must not cover focals**: a horn base once covered the eye. After
  placing anything big, re-check the focal view.
- **Ride the right bone**: jaw/tongue ride the skull, or they detach in motion.
- **Every part must TOUCH its host** — `part_attachment` BLOCKs a part whose
  nearest point still stands clear of the host surface. Tusks, trunks and plates
  used to float with the build reporting all green, and only a human eye caught
  them. The first third of a root is meant to be buried; that is what hides the
  seam. A part that cannot name what it touches is not attached.
- Eyes/ears anchor to the HEAD volume surface: `"anchor":
  {"chain":"head","t":0.40,"around":62}` — `around` in degrees from the top of
  the section (0=spine, 90=side, 180=belly). Wolf-class eyes sit at 55–70.
- On an anchored plate the host surface wins by default: the plate is snapped
  onto the surface normal and the direction you wrote survives as a reported
  difference. `"conform": false` when that written direction was deliberate.

## Stage-end gate

- Machine: build green + MID-stage claims (`part_exists` / `part_visible` /
  `part_signature` / `share_hierarchy` / `focal_contrast`).
- Whitelist blind-reads all passed.
- Human look #2: focal distribution right? part-to-body seams clean?
- Pass = part layout locks.
