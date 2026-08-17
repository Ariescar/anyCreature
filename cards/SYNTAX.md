# Spec JSON — the whole language on one page

```jsonc
{
 "palette": { "skin_torso": {"color":"#8a8a80","rough":0.95}, ... },  // one material PER PART
 "sections": { "flute": [[1,0],[0.6,0.4],...] },   // named 2D outlines, CONCAVE allowed (bark, crescents)

 "smooth_angle": 50,    // default: faces meeting at a vertex average when their normals sit within
                        // this many degrees; the vertex splits only at a REAL crease. Override per
                        // volume and per part. "faceted":true == smooth_angle 0.
 "shading": { "gradient":{"top":0.30,"bottom":-0.88},   // THE DEFAULTS. ONE value ramp over the
              "noise":{"size":0.018,"amount":0.26} },   // WHOLE body's Y range, on EVERY mesh,
                        // parts included; noise.size = FRACTION OF THE MODEL DIAGONAL, not metres.
 "build": "rigid",      // robots/constructs/golems/vehicles ONLY — lifts the faceted_body BLOCK

 "joints": {
   "Hips": [0, 0.9, 0],                            // absolute [x,y,z], y up, z forward
   "Chest": {"from":"Hips","fwd":0.1,"up":0.5},    // relational: fwd=+z up=+y side=+x
   "TailTip": {"from":"Tail2","dir":[0,-1,-0.4],"len":0.3},
   "LToe": {"from":"LKnee","fwd":0.1,"ground":0.03}  // ground = absolute Y (feet)
 },
 "joints_R": { "RElbow": {"from":"Chest","side":-0.3,"up":0.25} },
   // optional: reposition auto-mirrored R* joints — pairs GROW symmetric but the
   // bind POSE staggers (raised right arm); the mirrored skin follows its joints.
   // A FEW CENTIMETRES ONLY. The twin's mesh is grown on the LEFT bone path and
   // then dragged onto the right joints by translation, so a large offset shears
   // the volume instead of posing it: past ~10% of the limb's length it starts
   // squashing, past ~35% the right thigh comes out 40% of the left's depth with
   // its width untouched. mirror_distortion BLOCKs that. For a genuinely
   // different pose, take the limb OUT of "mirror" and author it as its own chain.
 "chains": { "torso":["Hips","Spine","Chest"], "LArm":[...], ... },
 "attach": { "LArm":"Chest", "head":"Neck" },      // every non-root chain → its host joint
 "mirror": ["LArm","LLeg"],                        // auto right-side twins (joints, meshes, anims)
 "touch": [["torso","tail"]],                      // declared connections MUST overlap or BLOCK

 "volumes": [{
   "chain":"torso", "material":"skin_torso", "sides":14, "frame":"up",
   "profile":[[0,0.3,0.35], [0.6,0.42,0.5,{"bias":-0.1,"sharp":true}], [1,0.2,0.22]],
     // rows [t, half-width, half-height, opts]; exp 2.5-4=boxy slab; bias<0 belly-full;
     // sharp = hard silhouette break; "section":"flute" = use a named outline
   "smooth_angle": 30,                             // optional per-volume override, crisper creases
     // "faceted":true on a VOLUME is a BLOCK (faceted_body) — an 800-tri torso becomes 800 shards
     // and AO bakes the mess into COLOR_0. Break a body with "sharp" rows or a lower smooth_angle.
   "caps":["dome","dome"], "ring_step":0.05,
   "colors": { "arcs":[{"from":0,"to":52,"color":"#57513f"}] }      // 0°=spine 180°=belly
     // arcs ONLY — colors.gradient / colors.noise are ignored (info: line); see "shading" above
 }],

 "parts": [
  { "type":"curve", "host":"Head", "material":"tusk", "mirrored":true,   // CURVED horn/tusk/trunk
    "offset":[0.06,0,0.1], "dir":[0.3,-0.6,0.7], "sides":8,
    "segments":[ {"len":0.1,"r":0.035,"ahead":20}, {"len":0.1,"r":0.028,"rise":35},
                 {"len":0.08,"r":0.015,"rise":30,"taper":true} ] },
    // steering is per-segment and ADDS UP down the chain. rise/fall/ahead/behind
    // pull the heading that many degrees toward that world axis; coil swings it in
    // the carried plane (rings, spirals); taper pinches the far end.
    // Four mild segments can finish somewhere you did not predict — the compiler
    // reports the accumulated total (info: ... accumulated to 123°). Read that line.

  { "type":"membrane", "name":"wing", "material":"wing_skin", "mirrored":true,  // skin between rib chains
    "cusp":0.25, "along":8, "across":3,
    "ribs":[ {"chain":"LArm"}, {"chain":"LFing2"}, {"chain":"LFing3"}, {"chain":"LTrail"} ] },
    // along = samples down each rib · across = columns between neighbouring ribs
    // cusp = how deeply the trailing edge scoops · per-rib "shorten":0.2 pulls one rib in
    // Ribs run leading→trailing and the LAST one has to come back to the body.
    // Leave it out at the far end and the silhouette never encloses — it reads as
    // spread fingers, not one sheet. The compiler measures the root gap and warns.

  { "type":"fin", "host":"Skull", "material":"plate", "thickness":0.02, "mirrored":true,
    "anchor":{"chain":"head","t":0.4,"around":60},   // around: 0=spine 90=side 180=belly
    // ⚠ that mapping is the BODY chain's frame. `around` is read in the host
    // SECTION's frame, so on a chain running vertically (a leg) the same numbers
    // point elsewhere: 0=inner, 90=FRONT, 180=OUTER, 270=back. Aiming a plate at
    // the outside of a thigh with 90 lands it on the front. The compiler prints
    // the world direction each anchored part actually faces — read that line,
    // do not reason from this comment.
    "udir":[0,0,1], "vdir":[0,1,0], "points":[[0,0],[0.1,0.02],[0.05,0.15]],
    "faceted":true },   // PARTS may face freely (or set "smooth_angle") — only VOLUMES are blocked
    // by default the host surface wins: an anchored part is snapped flat onto the
    // surface normal, and the direction you wrote survives only as a reported
    // difference. Set "conform":false when that written direction was the point.

  { "type":"eye", "host":"Brow", "material":"eye", "size":0.028,
    "anchor":{"chain":"head","t":0.4,"around":62} },  // both eyes from one entry; side of head ≈55-70

  { "type":"paw", "host":"LToe", "material":"skin_fist", "size":[0.3,0.25,0.2], "mirrored":true }
 ],

 "animations": {
   "move":   { "duration":0.95, "loop":true, "mirror_phase":0.5,
     "tracks": { "LFrontRoot": {"rx":[[0,-26],[0.5,28],[1,-26]]} } },   // rx..tz keys [fraction,deg|m]
   "attack": { "duration":0.7, "loop":false, "tracks": { ... } }
     // attack must COMMIT FORWARD — either route passes (attack_reach):
     //   REACH: something ends ≥15% of the body span past the bind front, or
     //   SWING: some part travels forward ≥45% of ITS OWN length.
     // You do NOT have to lunge. Planted on the spot, winding a limb, tail or
     // weapon BACK and sweeping it FORWARD counts. A sideways sweep does not —
     // the strike has to commit at the space in front of the body.
 },
 "style": "heavy",     // ONLY if 1:1 segment rhythm is the design (relaxes the 50:50 gate)
 "ao": false,          // debug only — vertex AO bakes automatically otherwise
 "keep_uv": true,      // opt-in UV atlas (TEXCOORD_0) for downstream texture bakes
 "qa_isolate": true    // MID part-isolation builds only: skips whole-body checks
}
```
`BLOCK:` = build refused (fix, costs no round) · `warn:` = a measure, you judge ·
`info:` = the compiler telling you what actually happened — always read them.
Shipped GLBs auto-merge primitives per material and export public bone names
(`LArm1Sh` convention) — internal spec names never leak.
