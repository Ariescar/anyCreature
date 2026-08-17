// ACS engine — mechanical checks (compile-time gate). Author: Ariescar.
// Warnings here are ERRORS: a failing check blocks the build (exit 1 in cli).
//  1. anim_integrity  — CPU-skin the mesh at sampled anim times; folded tris = 0,
//                       edge stretch ≤ 3×.  (kills twist/breakage like the wolf case)
//  2. proportion      — adjacent axis segments must not be 50:50 (dead rhythm),
//                       unless spec.style === 'heavy'.
//  3. balance         — mass centroid must project inside the support polygon.
'use strict';
const G = require('./geometry.js');
const { sampleKeys, eulerToQuat } = require('./anim.js');

// ── mat helpers (column-major mat4) ──
function quatMat(q) {
  const [x, y, z, w] = q;
  return [
    1-2*(y*y+z*z), 2*(x*y+z*w), 2*(x*z-y*w), 0,
    2*(x*y-z*w), 1-2*(x*x+z*z), 2*(y*z+x*w), 0,
    2*(x*z+y*w), 2*(y*z-x*w), 1-2*(x*x+y*y), 0,
    0, 0, 0, 1];
}
function matMul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
    for (let k = 0; k < 4; k++) o[c*4+r] += a[k*4+r] * b[c*4+k];
  return o;
}
function matVec(m, v) {
  return [
    m[0]*v[0]+m[4]*v[1]+m[8]*v[2]+m[12],
    m[1]*v[0]+m[5]*v[1]+m[9]*v[2]+m[13],
    m[2]*v[0]+m[6]*v[1]+m[10]*v[2]+m[14]];
}
function transMat(t) { return [1,0,0,0, 0,1,0,0, 0,0,1,0, t[0],t[1],t[2],1]; }

// world matrices for all joints at time-fraction t of an anim (or bind pose if anim null)
function jointWorlds(sk, locals, anim, t) {
  const rot = {}, trn = {};
  if (anim) for (const ch of anim._tracks || []) { /* unused */ }
  // build per-joint local TRS from compiled tracks
  const trackOf = {};
  if (anim) for (const [jn, tr] of Object.entries(anim.tracksResolved)) trackOf[jn] = tr;
  const world = new Array(sk.joints.length);
  sk.joints.forEach((j, i) => {
    let local = transMat(locals[i]);
    const tr = trackOf[j.name];
    if (tr) {
      const T = [
        locals[i][0] + (tr.tx ? sampleKeys(tr.tx, t) : 0),
        locals[i][1] + (tr.ty ? sampleKeys(tr.ty, t) : 0),
        locals[i][2] + (tr.tz ? sampleKeys(tr.tz, t) : 0)];
      const q = eulerToQuat(
        tr.rx ? sampleKeys(tr.rx, t) : 0,
        tr.ry ? sampleKeys(tr.ry, t) : 0,
        tr.rz ? sampleKeys(tr.rz, t) : 0);
      local = matMul(transMat(T), quatMat(q));
    }
    world[i] = j.parent < 0 ? local : matMul(world[j.parent], local);
  });
  return world;
}

function skinVerts(mesh, sk, world) {
  // v' = Σ w * world[j] * (v - bind[j])   (IBM is translate(-bind))
  return mesh.V.map((v, vi) => {
    const out = [0, 0, 0];
    for (const [jn, w] of mesh.skin[vi]) {
      const ji = sk.index[jn];
      const bind = sk.joints[ji].pos;
      const p = matVec(world[ji], G.sub(v, bind));
      out[0] += w * p[0]; out[1] += w * p[1]; out[2] += w * p[2];
    }
    return out;
  });
}

function foldCount(V, F, minArea2 = 0) {
  const tris = [];
  for (const f of F) { if (f.length === 3) tris.push(f); else tris.push([f[0],f[1],f[2]],[f[0],f[2],f[3]]); }
  const VN = V.map(() => [0, 0, 0]);
  const FN = tris.map(([a, b, c]) => {
    const n = G.cross(G.sub(V[b], V[a]), G.sub(V[c], V[a]));
    for (const i of [a, b, c]) { VN[i][0]+=n[0]; VN[i][1]+=n[1]; VN[i][2]+=n[2]; }
    return n;
  });
  let folds = 0;
  tris.forEach(([a, b, c], i) => {
    if (G.dot(FN[i], FN[i]) < minArea2) return; // degenerate slivers don't vote
    const s = G.add(G.add(VN[a], VN[b]), VN[c]);
    if (G.dot(FN[i], s) < 0) folds++;
  });
  return folds;
}

function runChecks(spec, sk, meshes, animsCompiled) {
  const fails = [];
  const warns = [];   // hoisted: checks above the part_overlap block also report measures
  const locals = require('./skeleton.js').localTranslations(sk);

  // ── faceted bodies are banned ─────────────────────────────────────────────
  // `faceted: true` on a VOLUME shatters the mass into one independent facet per
  // triangle — an 800-triangle torso becomes 800 shards — and because AO bakes
  // from those normals the mess ships inside COLOR_0, where no relighting can
  // reach it. Two real runs (gryphon, mammoth) came back 89% and 93% hard-edged
  // this way. Bodies are smooth-shaded. Parts — plates, spikes, claws, crystal,
  // armour — may still face freely; only volumes are covered.
  if (spec.build !== 'rigid') {
    const bad = (spec.volumes || []).filter(v => v.faceted).map(v => `"${v.chain}"`);
    if (bad.length)
      fails.push('faceted_body: volume(s) ' + bad.join(', ') + ' set "faceted": true — bodies are '
        + 'smooth-shaded. Put "sharp": true on the profile rows where the silhouette should break, '
        + 'or lower "smooth_angle" on that volume. If the creature really is a machine, declare '
        + '"build": "rigid" at spec level.');
  }

  // QA isolation builds ("qa_isolate": true): a lone part rendered for the MID
  // blind-read is not a creature — whole-body laws (balance, containment,
  // proportion…) don't apply. Geometry must still be sound.
  if (spec.qa_isolate) {
    let qaFolds = 0;
    for (const m of meshes) if (!m.doubleSided) qaFolds += foldCount(m.V, m.F);
    return { fails: qaFolds > 0 ? [`mesh_integrity: bind pose has ${qaFolds} flipped tris`] : [], warns: [] };
  }

  // resolve raw tracks (with mirrored twins) once per anim for CPU skinning
  const { mirrorName } = require('./skeleton.js');
  const animsResolved = Object.entries(spec.animations || {}).map(([name, a]) => {
    const tracks = { ...a.tracks };
    const phase = a.mirror_phase ?? 0;
    for (const cn of spec.mirror || []) {
      for (const jn of spec.chains[cn] || []) {
        if (!tracks[jn] || tracks[mirrorName(jn)]) continue;
        const dst = {};
        for (const [axis, keys] of Object.entries(tracks[jn])) {
          const flip = (axis === 'ry' || axis === 'rz' || axis === 'tx') ? -1 : 1;
          dst[axis] = keys.map(([t, v]) => [(t + phase) % 1, v * flip]).sort((p, q) => p[0] - q[0]);
        }
        tracks[mirrorName(jn)] = dst;
      }
    }
    return { name, tracksResolved: tracks };
  });

  // scale floors: ignore sub-centimetre noise relative to model size
  const allV0 = meshes.flatMap(m => m.V);
  const ys0 = allV0.map(v => v[1]);
  const modelH = Math.max(...ys0) - Math.min(...ys0) || 1;
  const edgeFloor = 0.015 * modelH;          // edges shorter than 1.5% of height don't vote
  const areaFloor2 = Math.pow(0.0004 * modelH * modelH, 2); // ~sliver faces don't vote

  // 1. anim_integrity
  const bindEdges = [];
  for (const m of meshes) {
    const edges = [];
    for (const f of m.F) for (let k = 0; k < f.length; k++) {
      const a = f[k], b = f[(k + 1) % f.length];
      const L = G.len(G.sub(m.V[a], m.V[b]));
      if (L >= edgeFloor) edges.push([a, b, L]);
    }
    bindEdges.push(edges);
  }
  for (const anim of animsResolved) {
    for (const t of [0, 0.2, 0.4, 0.6, 0.8]) {
      const world = jointWorlds(sk, locals, anim, t);
      // WHERE, not just how many. This check is ~83% of all blocks in practice,
      // and "10 flipped tris" with no location forces a binary search through
      // the spec. Name the mesh, and for a stretch name the joint driving it.
      let folds = 0, maxStretch = 0, worstFoldMesh = '', worstFolds = 0;
      let stretchMesh = '', stretchJoint = '';
      const nameOf = (m) => m.chain || m.part || m.material;
      const heaviestJoint = (m, vi) => {
        const infl = (m.skin && m.skin[vi]) || [];
        let best = '', bw = -1;
        for (const [jn, w] of infl) if (w > bw) { bw = w; best = jn; }
        return best;
      };
      meshes.forEach((m, mi) => {
        const V2 = skinVerts(m, sk, world);
        if (!m.doubleSided) {                       // open membranes have saddle regions; fold test assumes a closed surface
          const f = foldCount(V2, m.F, areaFloor2);
          folds += f;
          if (f > worstFolds) { worstFolds = f; worstFoldMesh = nameOf(m); }
        }
        for (const [a, b, L] of bindEdges[mi]) {
          const s = G.len(G.sub(V2[a], V2[b])) / L;
          if (s > maxStretch) {
            maxStretch = s; stretchMesh = nameOf(m);
            stretchJoint = heaviestJoint(m, a) || heaviestJoint(m, b);
          }
        }
      });
      if (folds > 0) fails.push(`anim_integrity: "${anim.name}" @${t.toFixed(1)} folds mesh — `
        + `${folds} flipped tris, worst in "${worstFoldMesh}" (${worstFolds}). A bend there is sharper `
        + `than the volume can absorb: reduce the rotation on the joint driving "${worstFoldMesh}", `
        + `raise "ring_step" on that volume so rings are not crowded through the bend, or add a joint `
        + `to split the bend across two segments.`);
      if (maxStretch > 3) fails.push(`anim_integrity: "${anim.name}" @${t.toFixed(1)} stretches an edge `
        + `${maxStretch.toFixed(1)}× in "${stretchMesh}", pulled by joint "${stretchJoint}" — that joint `
        + `is tearing the skin. Reduce its travel, or spread the same motion over more joints in the chain.`);
    }
  }

  // 2. proportion — axis chain, 50:50 ban on significant adjacent segments
  const mset = new Set(spec.mirror || []);
  const mirroredChains = new Set([...mset, ...[...mset].map(c => 'R' + c.slice(1))]);
  if (spec.style !== 'heavy') {
    for (const [cn, names] of Object.entries(spec.chains)) {
      // limbs are exempt (legs are naturally even) — but membership is decided by
      // spec.mirror, NOT by the chain's first letter. Testing the letter meant a
      // dead-rhythm chain slipped through by renaming "axis" to "Laxis".
      if (mirroredChains.has(cn)) continue;
      const segs = [];
      for (let i = 1; i < names.length; i++)
        segs.push(G.len(G.sub(spec.joints[names[i]] ?? [0,0,0], spec.joints[names[i-1]] ?? [0,0,0])));
      const total = segs.reduce((a, b) => a + b, 0);
      const mean = total / (segs.length || 1);
      for (let i = 0; i < segs.length - 1; i++) {
        // minor-segment filter is RELATIVE TO MEAN segment length (a fixed %-of-total
        // filter silently exempted almost every pair on long chains)
        if (segs[i] < 0.5 * mean || segs[i+1] < 0.5 * mean) continue;
        const r = Math.min(segs[i], segs[i+1]) / (Math.max(segs[i], segs[i+1]) || 1);
        // 0.923 aligns with the styling rule ("no 50:50 rhythm"); the old 0.96 left
        // a 0.92–0.96 blind band that let a 0.946 split through
        if (r > 0.923) fails.push(`proportion: chain "${cn}" segments ${names[i]}→${names[i+1]}→${names[i+2]} are 50:50 (${r.toFixed(2)}) — dead rhythm; aim for ~0.62–0.85 (declare "style":"heavy" to allow)`);
      }
    }
  }

  // 3. balance — centroid over support polygon (XZ convex hull of lowest verts)
  const allV = meshes.flatMap(m => m.V);
  const cen = allV.reduce((a, v) => G.add(a, v), [0,0,0]).map(x => x / allV.length);
  const ys = allV.map(v => v[1]); const ymin = Math.min(...ys), ymax = Math.max(...ys);
  const feet = allV.filter(v => v[1] < ymin + 0.08 * (ymax - ymin));
  if (feet.length >= 3) {
    const xs = feet.map(v => v[0]), zs = feet.map(v => v[2]);
    const inX = cen[0] >= Math.min(...xs) - 1e-6 && cen[0] <= Math.max(...xs) + 1e-6;
    const inZ = cen[2] >= Math.min(...zs) && cen[2] <= Math.max(...zs);
    if (!inX || !inZ) fails.push(`balance: mass centre (${cen[0].toFixed(2)},${cen[2].toFixed(2)}) falls outside the support footprint x[${Math.min(...xs).toFixed(2)},${Math.max(...xs).toFixed(2)}] z[${Math.min(...zs).toFixed(2)},${Math.max(...zs).toFixed(2)}] — it would tip over`);
  }

  // 4. root containment — attached volumes (legs/tail) must bury their root
  //    ring inside the host tube, or the open ring shows on the surface.
  const volsByChain = {};
  for (const m of meshes) if (m._rings && m.chain) volsByChain[m.chain] = m;
  for (const [cn, hostJoint] of Object.entries(spec.attach || {})) {
    const v = volsByChain[cn]; if (!v) continue;
    // host volume = the one whose chain contains the host joint
    const hostChain = Object.keys(spec.chains).find(c => volsByChain[c] && spec.chains[c].includes(hostJoint) && c !== cn);
    if (!hostChain) continue;
    const host = volsByChain[hostChain];
    const rootRing = v._rings[0];
    let inside = 0;
    for (const p of rootRing) {
      let best = Infinity, bs = 0;
      host._pts.forEach((c2, si) => { const d = G.len(G.sub(p, c2)); if (d < best) { best = d; bs = si; } });
      const ring = host._rings[bs]; const c2 = host._pts[bs];
      const rad = Math.max(...ring.map(q => G.len(G.sub(q, c2))));
      if (best < rad * 0.98) inside++;
    }
    if (inside < rootRing.length * 0.8)
      fails.push(`root_containment: chain "${cn}" root ring is ${Math.round(100 * (1 - inside / rootRing.length))}% outside its host "${hostChain}" — the open ring will show on the surface; bury the root joint deeper`);
  }

  // 5. limb clearance — mirrored volumes must not touch across the centreline
  //    (measured only on exposed verts below the torso)
  {
    const hostOf = cn => {
      const hj = (spec.attach || {})[cn]; if (!hj) return null;
      const hc = Object.keys(spec.chains).find(c => volsByChain[c] && spec.chains[c].includes(hj) && c !== cn);
      return hc ? volsByChain[hc] : null;
    };
    const containedInHost = (p, host) => {
      if (!host) return false;
      let best = Infinity, bs = 0;
      host._pts.forEach((c2, si) => { const d = G.len(G.sub(p, c2)); if (d < best) { best = d; bs = si; } });
      const rad = Math.max(...host._rings[bs].map(q => G.len(G.sub(q, host._pts[bs]))));
      // 1.05: verts within 5% of the host surface are thigh-belly SEAM geometry,
      // covered by the host silhouette — not a visible limb at the centreline.
      // (a zero-margin binary test flags every quadruped groin seam as "exposed")
      return best < rad * 1.05;
    };
    for (const cn of spec.mirror || []) {
      const v = volsByChain[cn]; if (!v) continue;
      const host = hostOf(cn);
      const exposed = v.V.filter(p => !containedInHost(p, host));
      if (!exposed.length) continue;
      const minX = Math.min(...exposed.map(p => Math.abs(p[0])));
      const clearance = 2 * minX;
      if (clearance < 0.03 * modelH)
        fails.push(`limb_clearance: "${cn}" and its mirror are ${clearance.toFixed(3)} apart at the centreline (need ≥ ${(0.03 * modelH).toFixed(3)}) — legs will interpenetrate in motion`);
    }
  }

  // 4b. part_attachment — root_containment above only walks `spec.attach`, whose
  //    candidates are meshes carrying BOTH `_rings` and `chain`. Parts (curve /
  //    fin / eye / paw / spike / membrane) have neither, so until now no part was
  //    ever checked for being attached to anything: tusks whose entire root ring
  //    floated 0.031 clear of the skull, a trunk 6/15 outside, a forehead plate
  //    0.050 above the surface at its nearest point — all shipped "all green"
  //    and were caught by eye, in the most expensive repair round of the run.
  //    The test is deliberately generous: a part only has to TOUCH its host.
  //    Eyes and conformed plates sit ON the surface (nearest ≈ 0) and pass; a
  //    part hanging in the air does not.
  {
    const gap = 0.015 * modelH;   // a part nearer than this counts as meeting the host
    for (const m of meshes) {
      if (!m.part || !m.hostChain) continue;
      // A mirrored twin is the source reflected across X, and its host volume is
      // the source's host reflected the same way — testing it against the LEFT
      // host would measure the width of the creature. The source carries the
      // verdict for both; any twin-only deformation is mirror_distortion's job.
      if (m._mirrorSrc) continue;
      const host = volsByChain[m.hostChain];
      if (!host || !host._rings) continue;
      let nearest = Infinity;
      for (const p of m.V) {
        let best = Infinity, bs = 0;
        host._pts.forEach((c2, si) => { const d = G.len(G.sub(p, c2)); if (d < best) { best = d; bs = si; } });
        const rad = Math.max(...host._rings[bs].map(q => G.len(G.sub(q, host._pts[bs]))));
        const outside = best - rad;          // <0 inside the host, >0 clear of it
        if (outside < nearest) nearest = outside;
      }
      if (nearest > gap)
        fails.push(`part_attachment: "${m.part}" never meets its host "${m.hostChain}" — its closest `
          + `point still stands ${nearest.toFixed(3)} clear of the surface (tolerance ${gap.toFixed(3)}). `
          + `It is floating: it will read as a detached sticker and drift the moment the host animates. `
          + `Bury the root inside the host (the first third of a root is meant to be embedded — that is `
          + `what hides the seam), or move its anchor onto the surface.`);
    }
  }

  // 5b. mirror_distortion — `joints_R` staggers a mirrored twin by TRANSLATING
  //    its vertices with skin weights: the mesh was grown along the LEFT bone
  //    path and is then linearly dragged onto the right joints. Small offsets
  //    read as a pose; large ones shear the volume — a thigh that measures
  //    0.38 deep on the left comes out 0.15 deep on the right while its width
  //    stays correct, which looks like the limb lost its volume. Nothing else
  //    catches this: the build is green, the silhouette from the left is fine,
  //    and only a look from the other side shows it.
  //    Without joints_R every axis ratio is exactly 1.00, so any deviation is
  //    distortion the skinning introduced, in either direction.
  {
    const extents = (V) => {
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (const v of V) for (let k = 0; k < 3; k++) {
        if (v[k] < lo[k]) lo[k] = v[k];
        if (v[k] > hi[k]) hi[k] = v[k];
      }
      return [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
    };
    const AXIS = ['width', 'height', 'depth'];
    for (const m of meshes) {
      if (!m._mirrorSrc) continue;
      const a = extents(m._mirrorSrc.V), b = extents(m.V);
      for (let k = 0; k < 3; k++) {
        if (a[k] < 1e-6) continue;
        const r = b[k] / a[k];
        const who = m._mirrorSrc.chain || m._mirrorSrc.part || m._mirrorSrc.material;
        const how = r < 1 ? 'collapsed' : 'stretched';
        if (r < 0.70 || r > 1.30)
          fails.push(`mirror_distortion: the mirrored twin of "${who}" has ${how} — ${AXIS[k]} `
            + `${b[k].toFixed(3)} against ${a[k].toFixed(3)} on the source (${(r * 100).toFixed(0)}%). `
            + `"joints_R" drags a mesh grown on the LEFT bone path onto the right joints by translation, `
            + `so a large offset shears the volume instead of posing it. Keep "joints_R" to a few `
            + `centimetres of stagger; for a genuinely different pose take the limb OUT of "mirror" `
            + `and author it as its own chain.`);
        else if (r < 0.88 || r > 1.12)
          warns.push(`mirror_distortion: mirrored twin of "${who}" is ${(r * 100).toFixed(0)}% of the `
            + `source's ${AXIS[k]} — "joints_R" is starting to shear the volume rather than pose it.`);
      }
    }
  }

  // 6. bind-pose integrity
  let bindFolds = 0;
  for (const m of meshes) if (!m.doubleSided) bindFolds += foldCount(m.V, m.F, areaFloor2);
  if (bindFolds > 0) fails.push(`mesh_integrity: bind pose has ${bindFolds} flipped tris — geometry folds into itself`);

  // 7. attack_reach — an attack must COMMIT FORWARD. Two ways to satisfy it,
  //    because a strike does not have to be a whole-body lunge:
  //      REACH — something ends up in the space in front of the body, i.e. past
  //              the bind-pose front. Enough to touch a target standing there.
  //      SWING — something travels forward far enough relative to ITS OWN bind
  //              position. A creature planted on the spot swinging an arm, a
  //              weapon or a tail is a legitimate attack; the root never moves
  //              and the hand still crosses a lot of ground.
  //    Either route passes. The old rule demanded half a body span PAST the
  //    nose, which forced every creature to fly forward and rejected every
  //    stand-and-swing design.
  {
    const atk = animsResolved.find(a => a.name === 'attack');
    if (atk) {
      const zs0 = allV0.map(v => v[2]);
      const maxZ0 = Math.max(...zs0);
      const span = Math.max(maxZ0 - Math.min(...zs0), modelH);
      const REACH_MIN = 0.15 * span;
      // A limb's travel is bounded by the LIMB, not by the body. Measuring the
      // swing against the body span is a dimensional error: it asks a wolf's
      // foreleg to cover most of the wolf. Each mesh is judged against its own
      // longest bind axis instead, so the same rule fits a claw, a tail and a
      // greatsword. Meshes too small to carry a strike (eyes, nostrils) do not
      // vote. Calibration: a foreleg swung ±20° travels 0.32 of its own length,
      // ±35° travels 0.51, ±55° travels 0.70 — 0.45 keeps the real swings.
      const SWING_FRAC = 0.45, MIN_PART = 0.10 * span;
      let reach = 0, swing = 0, swingName = '', swingRatio = 0;
      const extentOf = (m) => {
        let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (const v of m.V) for (let k = 0; k < 3; k++) {
          if (v[k] < lo[k]) lo[k] = v[k];
          if (v[k] > hi[k]) hi[k] = v[k];
        }
        return Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
      };
      for (let s = 0; s <= 20; s++) {
        const world = jointWorlds(sk, locals, atk, s / 20);
        for (const m of meshes) {
          const ext = extentOf(m);
          const V2 = skinVerts(m, sk, world);
          for (let i = 0; i < V2.length; i++) {
            const dz = V2[i][2] - maxZ0; if (dz > reach) reach = dz;
            if (ext < MIN_PART) continue;
            const tr = V2[i][2] - m.V[i][2];
            if (tr > swing) swing = tr;
            const ratio = tr / ext;
            if (ratio > swingRatio) { swingRatio = ratio; swingName = m.chain || m.part || m.material; }
          }
        }
      }
      if (reach < REACH_MIN && swingRatio < SWING_FRAC)
        fails.push(`attack_reach: "attack" neither reaches nor swings. Forward of the bind front: `
          + `${reach.toFixed(2)} (a reach needs ≥ ${REACH_MIN.toFixed(2)}). Best swing: "${swingName || 'none'}" `
          + `travels ${swing.toFixed(2)} forward = ${(swingRatio * 100).toFixed(0)}% of its own length `
          + `(a swing needs ≥ ${(SWING_FRAC * 100).toFixed(0)}%). Nothing commits at a target. `
          + `You do NOT have to lunge — standing on the spot and sweeping a limb, tail or weapon `
          + `counts, as long as it winds BACK and crosses FORWARD. Otherwise drive the root with tz keys.`);
    }
  }

  // 8. declared adjacency — "touch": [["chainA","chainB"], ...]. Declared-
  //    connected chains must actually meet; a gap reads as floating bodyparts.
  {
    const insideVol = (p, vol) => {
      let best = Infinity, bs = 0;
      vol._pts.forEach((c2, si) => { const d = G.len(G.sub(p, c2)); if (d < best) { best = d; bs = si; } });
      const c2 = vol._pts[bs];
      const rad = Math.max(...vol._rings[bs].map(q => G.len(G.sub(q, c2))));
      return best < rad * 0.98;
    };
    for (const [ca, cb] of spec.touch || []) {
      const A = volsByChain[ca], B = volsByChain[cb];
      if (!A || !B) { fails.push(`touch: pair ["${ca}","${cb}"] names a chain with no volume`); continue; }
      const eps = 0.01 * modelH;
      let met = false, best = Infinity;
      for (const p of A.V) { if (insideVol(p, B)) { met = true; break; } }
      if (!met) for (const p of B.V) { if (insideVol(p, A)) { met = true; break; } }
      if (!met) outer: for (const p of A.V) for (const q of B.V) {
        const d = G.len(G.sub(p, q)); if (d < best) best = d;
        if (d < eps) { met = true; break outer; }
      }
      if (!met)
        fails.push(`touch: "${ca}" and "${cb}" are declared connected but their surfaces stay ${best.toFixed(3)} apart — overlap the volumes so the join is buried`);
    }
  }

  // 9. part_overlap — a MEASURE, not a law: gross part-into-part interpenetration
  //    (the self-intersecting fist class). Reported as warn; you judge.
  {
    const parts = meshes.filter(m => m.part);
    for (let i = 0; i < parts.length; i++) for (let k = 0; k < parts.length; k++) {
      if (i === k) continue;
      const A = parts[i], B = parts[k];
      if (A.part.replace(/\.R$/, '') === B.part.replace(/\.R$/, '')) continue; // own mirror twin
      if (B.doubleSided) continue; // a zero-thickness membrane has a huge hollow box — it contains nothing
      const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
      for (const v of B.V) for (let a = 0; a < 3; a++) {
        if (v[a] < lo[a]) lo[a] = v[a];
        if (v[a] > hi[a]) hi[a] = v[a];
      }
      const c = [0, 1, 2].map(a => (lo[a] + hi[a]) / 2);
      const h = [0, 1, 2].map(a => (hi[a] - lo[a]) / 2);
      if (Math.min(...h) <= 0) continue;
      let inside = 0;
      for (const v of A.V)
        if (Math.abs(v[0] - c[0]) < h[0] && Math.abs(v[1] - c[1]) < h[1] && Math.abs(v[2] - c[2]) < h[2]) inside++;
      const frac = inside / A.V.length;
      if (frac > 0.45)
        warns.push(`part_overlap: '${A.part}' sits ${Math.round(frac * 100)}% inside '${B.part}' — check for interpenetration`);
    }
  }

  return { fails, warns };
}

module.exports = { runChecks, foldCount, skinVerts, jointWorlds };
