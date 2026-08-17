# 01 LOW — design free, then two gates (the big-form stage)

## 1. Interview (≤2 questions; skip any already answered)

Q1 Temperament: "What's the first feeling this creature should give?" (cute / solid / scary / free text)
Q2 Role: minion / NPC / boss → loads `harness/presets/<role>.json` (tri budget + animation list).

## 2. Silhouette brief (a few lines, then freeze)

Translate the order into the brief the gates will test against — identity ("reads as: tree + giant-proportioned humanoid"), feel ("heavy, crushing"), the ONE signature that must survive shrinking, and which view carries the identity. No method, no numbers you can't check.

## 3. Design FREE

Build the creature with the engine (syntax: `cards/SYNTAX.md`) exactly as you see fit — your own judgment, your own process. Only the pit-map applies (engine-local facts, not design rules):

- Anatomically independent masses get their OWN volumes, overlapping their neighbours (mane, shoulder, chest slab, head). Radius wiggle inside one tube reads as soft sausage, not as blocks.
- Wings spread flat in one plane vanish from the side — give them sweep-back. Every view needs a designed silhouette; a straight-line view is a dead view.
- The bind pose IS the pose. Creatures never stand bolt upright in a T-pose; plant the weight.
- Curved things (tusks, trunks, horns) are `curve`; membranes (wings, frills, sails) are `membrane` — don't fake either with straight spikes or flat plates.
- **Bends belong to JOINTS.** An arm that must flex needs its elbow joint placed where the bend lives; radius wiggle inside a straight tube gives you a bent sausage, not an elbow. Place the skeleton for the pose you want.

Measure every build:
```bash
node engine/cli.js spec.json out/creature.glb
node harness/silmetrics.mjs out/creature.glb out/rN
python3 harness/maskmetrics.py out/rN out/rN/sil_front.png out/rN/sil_side.png out/rN/sil_top.png out/rN/sil_hero.png
```
The report measures; YOU judge. Flags worth eyes: `sq_fill` (silhouette volume in a 1:1 frame), `mirror_sym` (only the FRONT view may be symmetric; wing pairs stagger even there), `straight_max` (plank-limb detector).

## 4. Gate 1 — RECOGNISED (all four views)

Spawn a context-free reader agent (a fresh subagent given NOTHING but the images) with exactly this task:

> Look at these images one at a time, answering only from what you SEE.
> 1) [thumb24 of the identity view] What FEELING does this shape give — heavy/stable, fast/agile, sharp/menacing, floating? One phrase.
> 2-5) [thumb48 of front / side / top / hero] What is this? What parts can you make out? Does this view read as a real creature, or as an abstract shape/nothing?

Judge the verbatim answers against the brief: identity wrong → repair (biggest shapes first). **Any view read as "abstract/nothing/a stick" fails the whole gate.** Feel mismatch → repair. The verdict IS the work order. Budget: 2 repair rounds, then iron law 3 (concept restart).

## 5. Gate 2 — PUNCHIER (after Gate 1; all four views must stay readable)

LOW is not done when it's recognisable — it's done when it's EXAGGERATED. Up to 2 rounds; each round may ONLY make the silhouette bolder: push the extreme proportion further, harden breaks, deepen negative space, exaggerate the signature. Spawn a fresh reader; show the PREVIOUS round's identity-view silhouette and the CURRENT one:

> Two silhouettes of a creature. Which is punchier — more striking, more tension? One sentence why.

Reader picks the old one = the round is reverted; try a different push or stop. Reader picks the new one and all four views still read = LOW passes. Skeleton and main volumes lock.

## 6. Outputs

`spec.json`, `creature.glb`, `out/rN/` per round (sils, thumbs, metrics, archived spec), reader verdicts verbatim in `log.md`.
