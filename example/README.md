# Example: the reference light quadruped (wolf)

`wolf.json` is the reference example — a light quadruped bred over 3 measured
rounds and kept in step with the engine: spec-level `shading`, `smooth_angle`
50, `colors.arcs` per volume, no faceted masses. Its `_template` and
`_anchor_numbers` fields are an ANCHOR to deviate from, not a target to
converge on; there is no `templates/` library any more (removed in 1.2.0).

Files: `wolf.glb` — skinned, animated, vertex-coloured, AO baked into COLOR_0,
UV off (`"keep_uv": true` is opt-in, and this spec does not set it) —
`wolf_beauty.png`, `wolf_silhouette.png`, `wolf_thumb24.png` (the blind-read
image).

Measured: high-saturation area **26.0%** of the tq view, mid-band for the
`saturation_area` claim (14%-34%).

```bash
# rebuild
node engine/cli.js example/wolf.json example/wolf.glb
# silhouettes (front/side/top/hero45) + numbers + 24/48px thumbs
node harness/silmetrics.mjs example/wolf.glb out/r1
# per-view measures + dullness flags
python3 harness/maskmetrics.py out/r1 out/r1/sil_front.png out/r1/sil_side.png \
        out/r1/sil_top.png out/r1/sil_hero.png
# metrics incl. hi_sat_share per view (add --spec <claims.json> to check claims)
node harness/judge.mjs example/wolf.glb out/j wolf
```
