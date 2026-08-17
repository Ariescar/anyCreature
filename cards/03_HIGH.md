# 03 HIGH (budget 1 round | build: colour + three animations)

## Colour — you choose freely; five norms bound the choice

Pick the palette yourself, from the creature's story. The norms:

1. **One high-saturation MAIN colour, spent on the signature part.** Saturation
   is a spotlight; if everything is saturated, nothing is.
2. **One secondary colour** for the big masses — quieter than the main.
3. **The ACCENT stays under 5%** of the surface (eye glow, claw tips, markings)
   — the memory spark. One accent temperature, not two. The 5% caps the ACCENT
   alone; it is not a cap on how much of the creature carries saturated colour —
   norm 4 sets that, and its floor sits well above 5%.
4. **Saturated area: 10%–34% — measured, not judged by eye.** The
   `saturation_area` claim counts the share of the view carrying HSV saturation
   ≥ 0.50, read on the UNLIT baked vertex colour, so brightness, AO and lighting
   cannot skew it. Below the floor the creature reads as a grey mass; above the
   ceiling saturation stops working as a spotlight. The band rules HOW MUCH,
   never WHERE — which surfaces carry the loud colour is your call. It agrees
   with norm 1: one main colour on the signature plus its supporting bands lands
   mid-band (the wolf example measures 26.0%). Out of band, raise or drop
   saturation on a mass that deserves the attention; do not tint everything.
5. **Brightness floor — do not crush to black.** The judge measures the beauty
   render's median luminance; a "dark" creature reads by VALUE STEPS between
   its masses, not by making everything dark. If the render medians below the
   floor, lift the mid masses, keep the darks only where a step needs them.

The engine bakes **per-vertex AO at compile** (crevices, pits, undersides
darken automatically — that's the "solid" look). The floor is measured AFTER
AO; never fight AO by flattening your colours, and never disable it to pass
(`"ao": false` exists only for debug builds).

Vertex colours come from two places. Per volume, `colors.arcs` bands the
section over that material's base colour (0°=spine, 180°=belly) — bands must
follow the form, spine band darkening the top plane, belly band lifting the
underside. Spec-level, ONE `shading` block ramps value over the WHOLE body's Y
range and lays one grain, on EVERY mesh — volumes, paws, ears, eyes, horns —
so the same numbers mean the same thing on an upright leg and a horizontal
torso, and no part reads as a sticker. Defaults: `gradient {top 0.30, bottom
-0.88}`, `noise {size 0.018, amount 0.26}`; `noise.size` is a fraction of the
model diagonal, so the grain scales with the creature. `colors.gradient` and
`colors.noise` are ignored now — the compiler says so in an `info:` line.
UV atlas is opt-in (`"keep_uv": true`) for downstream texture bakes; by default
the shipped file carries colour in vertices and stays lean.

## Animation — three, always: `idle`, `move`, `attack`

- The bar for idle/move: skinned, actually moving, no clipping, no explosions.
- **`attack` must COMMIT FORWARD — but it does not have to lunge.** The engine
  CPU-skins the clip and BLOCKS (`attack_reach`) only when nothing commits at the
  space in front of the body. Two ways to satisfy it, either is enough:
  **REACH** — something ends up ≥15% of the body span past the bind-pose front;
  **SWING** — some part travels forward ≥45% of its own length. So a creature
  planted on the spot, winding a foreleg, a tail or a weapon BACK and sweeping it
  FORWARD, passes. A ±20° twitch does not, and neither does a sideways sweep that
  never crosses toward the front. Wind up BACK first, then strike FORWARD.
- Channels stack: several tracks bending one segment = keep total bend modest,
  or `anim_integrity` blocks (folds / >3× edge stretch). Reduce bend or add a
  joint; don't fight the check.

```jsonc
"animations": {
  "move":   { "duration":0.95, "loop":true, "mirror_phase":0.5,
    "tracks": { "LFrontRoot": {"rx":[[0,-26],[0.5,28],[1,-26]]} } },
  "attack": { "duration":0.7, "loop":false, "tracks": {
    "Chest": {"rx":[[0,0],[0.25,-14],[0.5,22],[1,0]]},          // wind up, strike
    "Root":  {"tz":[[0,0],[0.25,-0.1],[0.5,0.9],[1,0]]} } }     // …and LUNGE
}
```

## Stage-end gate

- Machine: full claims re-run (styles, `rig_skinned`, `anim_named` incl.
  attack, motion amplitude, tri budget) — save the claims output, 04 ships it
  as the gate stamp.
- Human look #3 (final): value readability + play all three animations once.

Then read `cards/04_SHIP.md` — delivery and closing are scripted.
