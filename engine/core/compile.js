// ACS engine — spec compiler (M1: static geometry). Author: Ariescar.
// Agent-first: input is plain JSON. Joints are explicit 3D points (the agent
// does the proportional reasoning; the engine does the meshing).
//
// spec = {
//   name, height?,
//   palette: { material: {color:'#rrggbb', rough?, metal?} },
//   joints: { JointName: [x,y,z], ... },
//   chains: { chainName: [JointName, ...], ... },
//   volumes: [ { chain, material, profile: [[t, w, h], ...], frame?: 'auto'|'up'|'ground',
//               caps?: [start,end]  // 'fan'|'ngon'|'none'  } ],
//   parts: [
//     { type:'spike', host:JointName, offset:[x,y,z], dir:[x,y,z],
//       segments:[{len, r}...], material },
//     { type:'eye', host:JointName, forward:[x,y,z], spread, up?, size, material }
//       // eyes are first-class: ALWAYS placed on the forward hemisphere of the host.
//   ],
//   mirror?: [chainName...]   // chains to duplicate across X (names prefixed L/R)
// }
'use strict';
const G = require('./geometry.js');

// compiler narration. A spec declares intent; the geometry that comes out is
// the resolved result, and the two diverge quietly. Every place the engine
// resolves something the author did not state exactly — the realized bend of a
// curve, the angle a plate was turned to meet its surface — it says so here.
const INFO = [];
function drainInfo() { const out = INFO.slice(); INFO.length = 0; return out; }
function dirName(v) {
  const p = [];
  if (v[1] > 0.4) p.push('up'); if (v[1] < -0.4) p.push('down');
  if (v[2] > 0.4) p.push('fwd'); if (v[2] < -0.4) p.push('back');
  if (Math.abs(v[0]) > 0.4) p.push('side');
  return p.join('-') || 'level';
}

// value noise (deterministic, no Date/random)
function hash3(x, y, z) {
  let h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
function vnoise(p, scale) {
  const q = p.map(v => v / scale);
  const f = q.map(v => v - Math.floor(v)), i = q.map(Math.floor);
  const sm = f.map(v => v * v * (3 - 2 * v));
  let acc = 0;
  for (let dx = 0; dx <= 1; dx++) for (let dy = 0; dy <= 1; dy++) for (let dz = 0; dz <= 1; dz++) {
    const w = (dx ? sm[0] : 1 - sm[0]) * (dy ? sm[1] : 1 - sm[1]) * (dz ? sm[2] : 1 - sm[2]);
    acc += w * hash3(i[0] + dx, i[1] + dy, i[2] + dz);
  }
  return acc; // 0..1
}
// sRGB hex → LINEAR. COLOR_0 is defined as linear by glTF, and ao.js / glb.js
// have always linearised; this one used to skip the transfer function, so any
// volume carrying a `colors` block shipped ~1.5x too bright and its value steps
// collapsed (wolf's spine-vs-base contrast fell from 5.3x to 2.1x).
function hex2lin(h) {
  const x = parseInt(h.replace('#', ''), 16);
  const s = c => Math.pow(c / 255, 2.2);
  return [s((x >> 16) & 255), s((x >> 8) & 255), s(x & 255)];
}

function lerpProfile(profile, t) { // rows [t, w, h, {exp,bias,roll}?]
  const row = (r) => [r[1], r[2], r[3] || null];
  if (t <= profile[0][0]) return row(profile[0]);
  for (let i = 0; i < profile.length - 1; i++) {
    const [t0, w0, h0] = profile[i], [t1, w1, h1] = profile[i + 1];
    if (t <= t1) {
      const f = (t - t0) / (t1 - t0 || 1);
      const s0 = profile[i][3] || {}, s1 = profile[i + 1][3] || {};
      const mix = (a, b, d) => (a ?? d) + ((b ?? d) - (a ?? d)) * f;
      return [w0 + (w1 - w0) * f, h0 + (h1 - h0) * f,
        { exp: mix(s0.exp, s1.exp, 2), bias: mix(s0.bias, s1.bias, 0), roll: mix(s0.roll, s1.roll, 0),
          section: f < 0.5 ? s0.section : s1.section }];
    }
  }
  const last = profile[profile.length - 1]; return row(last);
}

function chainPoints(spec, chainName) {
  const names = spec.chains[chainName];
  if (!names) throw new Error(`unknown chain "${chainName}"`);
  return names.map(n => {
    const p = spec.joints[n];
    if (!p) throw new Error(`chain "${chainName}" references missing joint "${n}"`);
    return p.slice();
  });
}

// Catmull-Rom through profile rows: fat, ROUND masses instead of straight frustums
function crProfile(profile, t) {
  const n = profile.length;
  if (t <= profile[0][0]) return lerpProfile(profile, t);
  if (t >= profile[n - 1][0]) return lerpProfile(profile, t);
  let i = 0; while (i < n - 2 && t > profile[i + 1][0]) i++;
  const P = k => profile[Math.min(n - 1, Math.max(0, k))];
  const [p0, p1, p2, p3] = [P(i - 1), P(i), P(i + 1), P(i + 2)];
  const sharpAt = r => r[3] && r[3].sharp;
  if (sharpAt(p1) || sharpAt(p2)) return lerpProfile(profile, t); // hard silhouette break
  const f = (t - p1[0]) / (p2[0] - p1[0] || 1);
  const cr = (a, b, c, d) => {
    const f2 = f * f, f3 = f2 * f;
    return 0.5 * ((2 * b) + (-a + c) * f + (2 * a - 5 * b + 4 * c - d) * f2 + (-a + 3 * b - 3 * c + d) * f3);
  };
  const sec = lerpProfile(profile, t)[2]; // sections stay linear
  return [Math.max(0.004, cr(p0[1], p1[1], p2[1], p3[1])),
          Math.max(0.004, cr(p0[2], p1[2], p2[2], p3[2])), sec];
}

function buildVolume(spec, vol) {
  const sides = vol.sides || 12;
  const joints = chainPoints(spec, vol.chain);
  // arc-length table over the joint polyline
  const jArc = [0];
  for (let i = 1; i < joints.length; i++) jArc.push(jArc[i - 1] + G.len(G.sub(joints[i], joints[i - 1])));
  const total = jArc[jArc.length - 1] || 1;
  // DENSE resample: ring every ~step of arc, joints no longer dictate density
  const step = vol.ring_step || Math.max(0.035, total / 36);
  const M = Math.max(joints.length, Math.min(48, Math.round(total / step)));
  const pts = []; const ringT = []; const ringSkin = [];
  const names = spec.chains[vol.chain];
  for (let m = 0; m <= M; m++) {
    const a = (m / M) * total;
    let i = 0; while (i < jArc.length - 2 && a > jArc[i + 1]) i++;
    const f = (a - jArc[i]) / (jArc[i + 1] - jArc[i] || 1);
    pts.push(G.add(G.mul(joints[i], 1 - f), G.mul(joints[i + 1], f)));
    ringT.push(a / total);
    // snap-style skinning: blend the two bracketing joints, smoothstep for soft bends
    const sf = f * f * (3 - 2 * f);
    ringSkin.push(sf < 0.001 ? [[names[i], 1]] : sf > 0.999 ? [[names[i + 1], 1]]
      : [[names[i], 1 - sf], [names[i + 1], sf]]);
  }
  let prof = ringT.map(t => crProfile(vol.profile, t));
  // corner bevel-skip: at sharp path corners, rings inside the compression
  // zone (r·tan(θ/2)) would interpenetrate on the inner side — drop them and
  // let one span bridge the corner. Kills the fold class at any bend.
  {
    const keep = pts.map(() => true);
    for (let m = 1; m < pts.length - 1; m++) {
      const d0 = G.nrm(G.sub(pts[m], pts[m - 1])), d1 = G.nrm(G.sub(pts[m + 1], pts[m]));
      const cosA = Math.max(-1, Math.min(1, G.dot(d0, d1)));
      const th = Math.acos(cosA);
      if (th < 0.17) continue; // <10°: harmless
      const r = Math.max(prof[m][0], prof[m][1]);
      const ex = r * Math.tan(th / 2) * 1.2;
      for (let k = 1; k < pts.length - 1; k++) {
        if (k === m || !keep[k]) continue;
        const d = G.len(G.sub(pts[k], pts[m]));
        if (d < ex) keep[k] = false;
      }
    }
    const f = (arr) => arr.filter((_, i) => keep[i]);
    const pts2 = f(pts), prof2 = f(prof), rt2 = f(ringT), rs2 = f(ringSkin);
    pts.length = 0; pts.push(...pts2);
    prof = prof2; ringT.length = 0; ringT.push(...rt2);
    ringSkin.length = 0; ringSkin.push(...rs2);
  }
  // profile slope warning — the precursor to the fold class. `ring_step` sets how
  // far apart rings sit; the profile sets how fast the radius changes. When the
  // radius moves further between two rings than the rings are apart, the surface
  // turns more than 45° in one span and the next bend flips triangles. Scaling a
  // volume up without scaling `ring_step` with it is the usual way in — and the
  // failure surfaces much later, as "N flipped tris" during an animation.
  {
    let worst = 0, at = 0;
    for (let m = 1; m < pts.length; m++) {
      const ds = G.len(G.sub(pts[m], pts[m - 1]));
      if (ds < 1e-6) continue;
      const dr = Math.max(Math.abs(prof[m][0] - prof[m - 1][0]), Math.abs(prof[m][1] - prof[m - 1][1]));
      const slope = dr / ds;
      if (slope > worst) { worst = slope; at = ringT[m]; }
    }
    if (worst > 0.8) {
      const r = Math.max(prof[0][0], prof[0][1]);
      INFO.push(`WARN volume "${vol.chain}": profile slope ${worst.toFixed(2)} at t=${at.toFixed(2)} `
        + `(ring spacing ${(vol.ring_step || Math.max(0.035, total / 36)).toFixed(3)} vs radius ~${r.toFixed(3)}) `
        + `— rings are crowded relative to how fast the radius changes; this is the shape that flips `
        + `triangles once it bends. Raise "ring_step" on this volume, or soften the profile row there.`);
    }
  }

  const frame = vol.frame === 'up' ? true : vol.frame === 'ground' ? 'ground' : false;
  const resolveSec = (s) => {
    if (!s) return {};
    if (typeof s === 'string') s = { section: s };
    if (s.section) {
      const pp = (spec.sections || {})[s.section];
      if (!pp) throw new Error(`unknown named section "${s.section}"`);
      return { ...s, pts: pp };
    }
    return s;
  };
  const secs = prof.map(r => resolveSec(r[2] || vol.section));
  const rr = prof.map(r => [r[0], r[1]]);
  const rings = require('./section.js').chainRingsRich(pts, rr, sides, frame, secs);
  const capMap = c => c === 'dome' ? 'fanx' : c;
  const caps = (vol.caps || ['ngon', 'ngon']).map(capMap);
  const part = G.partFromRings(rings, sides, caps[0], caps[1], pts);
  // snap skinning: each ring blends its two bracketing joints
  const vIndex = new Map(); part.v.forEach((p, i) => vIndex.set(p, i));
  const skin = part.v.map(() => null);
  part.rings.forEach((ring, s) => {
    for (const p of ring) skin[vIndex.get(p)] = ringSkin[s].map(x => x.slice());
  });
  part.v.forEach((p, i) => {
    if (skin[i]) return;
    const d0 = G.len(G.sub(p, pts[0])), d1 = G.len(G.sub(p, pts[pts.length - 1]));
    skin[i] = [[d0 < d1 ? names[0] : names[names.length - 1], 1]];
  });
  // ── vertex colours: arc bands (0°=spine, 180°=belly) + gradient + noise ──
  const colSpec = vol.colors || {};
  const base = hex2lin((spec.palette[vol.material] || {}).color || '#888888');
  const arcs = (colSpec.arcs || []).map(a => ({ from: a.from, to: a.to, c: hex2lin(a.color) }));
  const C = part.v.map(() => null);
  const rollOf = s2 => (secs[s2] && secs[s2].roll) || 0;
  part.rings.forEach((ring, s2) => {
    ring.forEach((pnt, k) => {
      const vi = vIndex.get(pnt);
      const aDeg = (360 * k / sides + rollOf(s2) * 180 / Math.PI) % 360;
      const fromTop = (450 - aDeg) % 360;                 // 0=top(+W), 180=bottom
      const sym = fromTop > 180 ? 360 - fromTop : fromTop; // symmetric 0..180
      let c = base;
      for (const a of arcs) if (sym >= a.from && sym <= a.to) c = a.c;
      C[vi] = c.slice();
    });
  });
  for (let i = 0; i < C.length; i++) if (!C[i]) C[i] = base.slice();
  // gradient and noise are NOT applied here any more — they are one whole-body
  // pass in applyShading() below, so every mesh (paws, ears, eyes included)
  // shares one top-to-bottom ramp and one grain size. Arc bands stay local.
  if (colSpec.gradient || colSpec.noise)
    INFO.push(`volume "${vol.chain}": colors.gradient/noise are ignored — shading is one spec-level pass now (see "shading")`);
  return { material: vol.material, V: part.v, F: part.fq, skin, C, chain: vol.chain,
    faceted: vol.faceted,
    _rings: part.rings, _pts: pts, _sides: sides, _ringT: ringT.slice(),
    _ringIdx: part.rings.map(ring => ring.map(p => vIndex.get(p))) };
}

// surface point of a built volume at (t along chain, angle from top in degrees).
// Rings are indexed by their true arc-length t (_ringT), NOT by array position —
// bevel-skip drops rings, so index-proportional lookup lands on the wrong ring.
function surfacePoint(builtVols, anchor) {
  const bv = builtVols[anchor.chain];
  if (!bv) throw new Error(`anchor chain "${anchor.chain}" has no built volume`);
  const rt = bv._ringT; const n = rt.length;
  let s1 = 0; while (s1 < n - 1 && rt[s1] < anchor.t) s1++;
  const s0 = Math.max(0, s1 - 1);
  const span = rt[s1] - rt[s0];
  const f0 = span > 1e-9 ? Math.min(1, Math.max(0, (anchor.t - rt[s0]) / span)) : 0;
  const N = bv._sides;
  const fromTop = ((anchor.around % 360) + 360) % 360;
  const aDeg = (450 - fromTop) % 360;
  const kf = (aDeg / 360) * N;
  const k0 = Math.floor(kf) % N, k1 = (k0 + 1) % N, f = kf - Math.floor(kf);
  const at = s => G.add(G.mul(bv._rings[s][k0], 1 - f), G.mul(bv._rings[s][k1], f));
  const p = G.add(G.mul(at(s0), 1 - f0), G.mul(at(s1), f0));
  const c = G.add(G.mul(bv._pts[s0], 1 - f0), G.mul(bv._pts[s1], f0));
  const out = G.nrm(G.sub(p, c));
  return { p, out, center: c };
}

function buildSpike(spec, p) {
  const host = spec.joints[p.host];
  if (!host) throw new Error(`spike host joint "${p.host}" missing`);
  const dir = G.nrm(p.dir); const pts = [G.add(host, p.offset || [0, 0, 0])];
  const radii = [p.segments[0].r];
  for (const s of p.segments) { pts.push(G.add(pts[pts.length - 1], G.mul(dir, s.len))); radii.push(Math.max(s.r * 0.35, 0.004)); }
  const rings = G.chainRings(pts, radii, p.sides || 6, false);
  const part = G.partFromRings(rings, p.sides || 6, 'ngon', 'fan', pts);
  return { material: p.material, V: part.v, F: part.fq,
    skin: part.v.map(() => [[p.host, 1]]) };
}

function buildEye(spec, p, builtVols) {
  // First-class eyes: placed on the FORWARD hemisphere of the host joint,
  // spread apart on ±X, always looking along `forward` (default +Z).
  const host = spec.joints[p.host];
  if (!host) throw new Error(`eye host joint "${p.host}" missing`);
  const fwd = G.nrm(p.forward || [0, 0, 1]);
  const up = G.nrm(p.up || [0, 1, 0]);
  const side = G.nrm(G.cross(up, fwd));
  const out = [];
  for (const sx of [1, -1]) {
    let c;
    if (p.anchor) { // ride ON the volume surface, bulging out
      const sp = surfacePoint(builtVols, { ...p.anchor, around: p.anchor.around * sx });
      c = G.add(sp.p, G.mul(sp.out, -(p.size ?? 0.05) * 0.35));
    } else {
      c = G.add(G.add(G.add(host, G.mul(fwd, p.face ?? 0.9 * (p.dist ?? 0.3))),
        G.mul(side, sx * (p.spread ?? 0.15))), G.mul(up, p.height ?? 0));
    }
    // small icosphere-ish octahedron subdivided once is enough at these sizes
    const r = p.size ?? 0.05; const V = []; const F = [];
    const oct = [[0,r,0],[0,-r,0],[r,0,0],[-r,0,0],[0,0,r],[0,0,-r]];
    const faces = [[0,4,2],[0,2,5],[0,5,3],[0,3,4],[1,2,4],[1,5,2],[1,3,5],[1,4,3]];
    // subdivide once + project to sphere
    const cache = new Map(); const mid = (a,b) => {
      const k = a < b ? a + '_' + b : b + '_' + a;
      if (cache.has(k)) return cache.get(k);
      const m = G.mul(G.nrm(G.add(oct[a] ?? V[a], oct[b] ?? V[b])), r);
      V.push(m); cache.set(k, oct.length + V.length - 1); return oct.length + V.length - 1;
    };
    const allV = oct.slice();
    const tris = [];
    for (const [a,b,c] of faces) {
      const ab = mid(a,b), bc = mid(b,c), ca = mid(c,a);
      tris.push([a,ab,ca],[ab,b,bc],[ca,bc,c],[ab,bc,ca]);
    }
    for (const v of V) allV.push(v);
    const Vw = allV.map(v => G.add(c, G.mul(G.nrm(v), r)));
    out.push({ material: p.material || 'eye', V: Vw, F: tris,
      skin: Vw.map(() => [[p.host, 1]]) });
  }
  return out;
}

function buildCurve(spec, p) {
  // Curved tapering tube — horns, tusks, trunks, tentacles. Each segment's
  // steering is applied on top of the heading it inherits, so bends ADD UP
  // down the chain: `rise`/`fall`/`ahead`/`behind` pull the heading that many
  // degrees toward the matching world axis, and `coil` swings it in the plane
  // carried along with the tube, which is what produces rings and spirals.
  // Because they accumulate, four mild segments can end up pointing somewhere
  // nobody predicted, so the realized path is reported as one info line rather
  // than discovered in the render.
  const host = spec.joints[p.host];
  if (!host) throw new Error(`curve host joint "${p.host}" missing`);
  let t = G.nrm(p.dir || [0, 0, 1]);
  let side = Math.abs(t[1]) < 0.9 ? G.nrm(G.cross([0, 1, 0], t)) : [1, 0, 0];
  const rad = d => d * Math.PI / 180;
  const pts = [G.add(host, p.offset || [0, 0, 0])];
  const radii = [p.segments[0].r];
  const AX = { rise: [0, 1, 0], fall: [0, -1, 0], ahead: [0, 0, 1], behind: [0, 0, -1] };
  for (const seg of p.segments) {
    for (const [k, dv] of Object.entries(AX)) {
      if (!seg[k]) continue;
      const ax = G.cross(t, dv), l = G.len(ax);
      if (l < 1e-6) continue;
      const axn = G.mul(ax, 1 / l);
      t = G.nrm(G.rod(t, axn, rad(seg[k])));
      side = G.nrm(G.rod(side, axn, rad(seg[k])));
    }
    if (seg.coil) t = G.nrm(G.rod(t, side, rad(seg.coil)));
    pts.push(G.add(pts[pts.length - 1], G.mul(t, seg.len)));
    radii.push(seg.taper ? Math.max(seg.r * 0.3, 0.004) : seg.r);
  }
  const sides = p.sides || 8;
  const rings = G.chainRings(pts, radii, sides, false);
  const part = G.partFromRings(rings, sides, 'ngon', 'fan', pts);
  const d0 = G.nrm(p.dir || [0, 0, 1]);
  const bend = Math.acos(Math.max(-1, Math.min(1, G.dot(d0, t)))) * 180 / Math.PI;
  const dy = pts[pts.length - 1][1] - pts[0][1];
  if (bend > 15) INFO.push(`curve '${p.name || p.host}': steering accumulated to ${bend.toFixed(0)}° — starts ${dirName(d0)}, finishes ${dirName(t)}, far end ${dy >= 0 ? '+' : ''}${dy.toFixed(2)} in y`);
  return { material: p.material, V: part.v, F: part.fq, faceted: p.faceted,
    skin: part.v.map(() => [[p.host, 1]]) };
}

function buildMembrane(spec, p) {
  // Membrane stretched between rib joint-chains — wings, frills, sails, webbed feet.
  // What the viewer reads is the enclosed silhouette, not the ribs inside it, so
  // ribs are listed leading edge → trailing edge and the last one has to come back
  // to the body. A last rib left out at the far end leaves the shape unenclosed:
  // it reads as spread fingers rather than one sheet. The compiler measures the
  // root gap and says so.
  const ribs = p.ribs.map(r => {
    const names = r.chain ? spec.chains[r.chain] : r.joints;
    if (!names) throw new Error(`membrane rib references unknown chain "${r.chain}"`);
    return names.map(n => {
      const q = spec.joints[n];
      if (!q) throw new Error(`membrane rib joint "${n}" missing`);
      return { n, p: q };
    });
  });
  const S = p.along || 8, U = p.across || 3;
  const sampled = ribs.map((rib, ri) => {
    const pl = rib.map(x => x.p);
    const arc = [0];
    for (let i = 1; i < pl.length; i++) arc.push(arc[i - 1] + G.len(G.sub(pl[i], pl[i - 1])));
    const L = arc[arc.length - 1] || 1;
    const t1 = 1 - (p.ribs[ri].shorten || 0);
    const out = [];
    for (let sI = 0; sI <= S; sI++) {
      const tt = (t1 * sI / S) * L;
      let i = 0; while (i < arc.length - 2 && tt > arc[i + 1]) i++;
      const f = (tt - arc[i]) / (arc[i + 1] - arc[i] || 1);
      out.push({
        p: G.add(G.mul(pl[i], 1 - f), G.mul(pl[i + 1], f)),
        skin: f < 0.01 ? [[rib[i].n, 1]] : f > 0.99 ? [[rib[i + 1].n, 1]]
          : [[rib[i].n, 1 - f], [rib[i + 1].n, f]],
      });
    }
    return out;
  });
  const C = (ribs.length - 1) * U + 1;   // grid columns
  const V = [], skin = [], F = [];
  const colPt = (j, sI) => {
    const r = Math.min(ribs.length - 2, Math.floor(j / U));
    const u = (j - r * U) / U;
    const a = sampled[r][sI], b = sampled[r + 1][sI];
    let pnt = G.add(G.mul(a.p, 1 - u), G.mul(b.p, u));
    if (sI === S && u > 0 && u < 1 && (p.trailing || 'cusp') === 'cusp') {
      const rootMid = G.mul(G.add(sampled[r][0].p, sampled[r + 1][0].p), 0.5);
      const tipMid = G.mul(G.add(sampled[r][S].p, sampled[r + 1][S].p), 0.5);
      const outDir = G.nrm(G.sub(tipMid, rootMid));
      const span = G.len(G.sub(sampled[r + 1][S].p, sampled[r][S].p));
      pnt = G.sub(pnt, G.mul(outDir, (p.cusp ?? 0.25) * span * Math.sin(Math.PI * u)));
    }
    const w = [];
    for (const [jn, ww] of a.skin) w.push([jn, ww * (1 - u)]);
    for (const [jn, ww] of b.skin) w.push([jn, ww * u]);
    return { pnt, w: w.filter(x => x[1] > 0.001) };
  };
  for (let j = 0; j < C; j++) for (let sI = 0; sI <= S; sI++) {
    const { pnt, w } = colPt(j, sI);
    V.push(pnt); skin.push(w);
  }
  const idx = (j, sI) => j * (S + 1) + sI;
  for (let j = 0; j < C - 1; j++) for (let sI = 0; sI < S; sI++)
    F.push([idx(j, sI), idx(j + 1, sI), idx(j + 1, sI + 1), idx(j, sI + 1)]);
  if (ribs.length >= 3) {
    const gap = G.len(G.sub(sampled[0][0].p, sampled[sampled.length - 1][0].p));
    let reach = 0;
    for (const col of sampled) for (const q of col) reach = Math.max(reach, G.len(G.sub(q.p, sampled[0][0].p)));
    if (gap > 0.35 * reach)
      INFO.push(`WARN membrane '${p.name || 'membrane'}': root gap ${gap.toFixed(2)} between the leading and trailing ribs, ${Math.round(100 * gap / reach)}% of this membrane's own reach. Nothing brings the trailing rib home, so the silhouette stays unenclosed and reads as spread fingers instead of one sheet — end the rib list back at the body.`);
  }
  return { material: p.material, V, F, skin, doubleSided: true, faceted: p.faceted };
}

function buildPaw(spec, p) {
  // Independent paw object: flattened ellipsoid pad with a FLAT sole,
  // snapped under the leg-end joint. size = [length(fwd), width, height].
  const host = spec.joints[p.host];
  if (!host) throw new Error(`paw host joint "${p.host}" missing`);
  const [L, W2, H] = p.size || [0.14, 0.10, 0.07];
  const c = G.add(host, p.offset || [0, H * 0.45 - host[1], L * 0.18]); // sole on ground
  const V = []; const F = [];
  const N1 = p.sides || 10, N2 = 5; // longitude × latitude
  for (let j = 0; j <= N2; j++) {
    const phi = (j / N2) * Math.PI / 2;             // upper hemisphere only
    for (let k = 0; k < N1; k++) {
      const th = 2 * Math.PI * k / N1;
      V.push([c[0] + Math.cos(th) * Math.cos(phi) * W2 / 2 * (1 + 0.15 * Math.sin(th)),
              c[1] + Math.sin(phi) * H,
              c[2] + Math.sin(th) * Math.cos(phi) * L / 2]);
    }
  }
  for (let j = 0; j < N2; j++) for (let k = 0; k < N1; k++)
    F.push([j * N1 + k, (j + 1) * N1 + k, (j + 1) * N1 + (k + 1) % N1, j * N1 + (k + 1) % N1]);
  // flat sole: ngon fan on bottom ring (faces down)
  const ci = V.length; V.push([c[0], c[1], c[2]]);
  for (let k = 0; k < N1; k++) F.push([k, (k + 1) % N1, ci]);
  return { material: p.material, V, F, skin: V.map(() => [[p.host, 1]]) };
}

const { mirrorName } = require('./skeleton.js');
function buildFin(spec, p, builtVols) {
  // Flat plate with thickness: outline points [[u,v],...] in a plane at host,
  // plane axes given by udir/vdir (world), extruded ±thickness/2 along normal.
  const host = spec.joints[p.host];
  if (!host) throw new Error(`fin host joint "${p.host}" missing`);
  let U = G.nrm(p.udir || [0, 0, 1]), Vv = G.nrm(p.vdir || [0, 1, 0]);
  let Nn = G.nrm(G.cross(U, Vv));
  let o = G.add(host, p.offset || [0, 0, 0]);
  if (p.anchor) {
    const sp = surfacePoint(builtVols, p.anchor);
    o = sp.p;
    // `around` is measured in the host section's own frame. On a body chain that
    // frame gives the documented 0=spine / 90=side / 180=belly. On a chain that
    // runs vertically (a leg) the same numbers point somewhere else entirely —
    // 90 comes out FRONT, 180 comes out OUTER — so a plate aimed at the outside
    // of a thigh silently lands on its front. Say where it actually went.
    INFO.push(`fin '${p.name || p.host}' anchored on "${p.anchor.chain}" at around=${p.anchor.around ?? 0}`
      + ` faces ${dirName(sp.out)} (world normal ${sp.out.map(x => x.toFixed(2)).join(',')})`
      + ` — "around" is read in the host section's frame, NOT in world space; verify this is the side you meant`);
    if (p.conform !== false) {
      // Default behaviour: the host surface wins. The plate's normal is snapped
      // onto the surface normal at the landing point, and whatever direction the
      // spec asked for is kept only as a measured difference. Opt out per part.
      const dev = Math.acos(Math.max(-1, Math.min(1, G.dot(Nn, sp.out)))) * 180 / Math.PI;
      const U2 = G.sub(U, G.mul(sp.out, G.dot(U, sp.out)));
      if (G.len(U2) > 1e-4) {
        Nn = sp.out.slice();
        U = G.nrm(U2);
        Vv = G.nrm(G.cross(Nn, U));
        if (dev > 25) INFO.push(`fin '${p.name || p.host}': the host surface rotated this plate ${dev.toFixed(0)}° off the direction the spec asked for. If that written direction was the point, set "conform": false on this part.`);
      }
    }
  }
  const th = (p.thickness ?? 0.03) / 2;
  const pOutline = p.points; if (!pOutline || pOutline.length < 3) throw new Error('fin needs >=3 outline points');
  // canonicalise outline to CCW in (u,v) — makes every winding below deterministic
  let area2 = 0;
  for (let i = 0; i < pOutline.length; i++) {
    const [u0, v0] = pOutline[i], [u1, v1] = pOutline[(i + 1) % pOutline.length];
    area2 += u0 * v1 - u1 * v0;
  }
  const poly = area2 < 0 ? pOutline.slice().reverse() : pOutline;
  const ring = poly.map(([u, v]) => G.add(o, G.add(G.mul(U, u), G.mul(Vv, v))));
  const V = [];
  for (const q of ring) V.push(G.add(q, G.mul(Nn, th)));
  for (const q of ring) V.push(G.sub(q, G.mul(Nn, th)));
  const n = ring.length; const F = [];
  for (let i = 1; i < n - 1; i++) F.push([0, i, i + 1]);            // front fan (+N)
  for (let i = 1; i < n - 1; i++) F.push([n, n + i + 1, n + i]);    // back fan (−N)
  for (let i = 0; i < n; i++) F.push([n + i, n + (i + 1) % n, (i + 1) % n, i]); // rim (outward)
  return { material: p.material, V, F, skin: V.map(() => [[p.host, 1]]) };
}

function mirrorMesh(m, rDelta) { // duplicate across X with flipped winding + L→R joints
  // rDelta: per-R-joint translation from "joints_R" pose overrides — verts follow
  // their joints by skin weight, so a staggered right side carries its skin along
  const shift = (v, infl) => {
    if (!rDelta || !infl) return v;
    let dx = 0, dy = 0, dz = 0;
    for (const [j, w] of infl) {
      const d = rDelta[mirrorName(j)];
      if (d) { dx += w * d[0]; dy += w * d[1]; dz += w * d[2]; }
    }
    return [v[0] + dx, v[1] + dy, v[2] + dz];
  };
  return { material: m.material, faceted: m.faceted, smoothAngle: m.smoothAngle,
    doubleSided: m.doubleSided,
    V: m.V.map((v, i) => shift([-v[0], v[1], v[2]], m.skin && m.skin[i])),
    F: m.F.map(f => f.slice().reverse()),
    C: m.C ? m.C.map(c => c.slice()) : undefined,
    skin: m.skin ? m.skin.map(infl => infl.map(([j, w]) => [mirrorName(j), w])) : undefined,
    // index-based ring topology survives mirroring → mirrored volumes still get
    // proper cylindrical UVs (their own atlas island, required for AO bakes)
    _ringIdx: m._ringIdx, _ringT: m._ringT, _sides: m._sides,
    _pts: m._pts ? m._pts.map(p => [-p[0], p[1], p[2]]) : undefined };
}

function rPoseDeltas(spec) {   // joints_R override − default mirror = per-joint shift
  if (!spec.joints_R) return null;
  const d = {};
  for (const [rn, pos] of Object.entries(spec.joints_R)) {
    const lp = spec.joints['L' + rn.slice(1)];
    if (!lp) continue;
    d[rn] = [pos[0] + lp[0], pos[1] - lp[1], pos[2] - lp[2]];  // default was [-lx, ly, lz]
  }
  return d;
}

function compile(spec) {
  const meshes = []; const builtVols = {}; const rd = rPoseDeltas(spec);
  // smoothing angle: spec-level default (50°), overridable per volume/part.
  // mirrorMesh copies it along with everything else it carries.
  const defSmooth = spec.smooth_angle ?? 50;
  for (const vol of spec.volumes || []) {
    const m = buildVolume(spec, vol);
    m.smoothAngle = vol.smooth_angle ?? defSmooth;
    builtVols[vol.chain] = m;
    meshes.push(m);
    if ((spec.mirror || []).includes(vol.chain)) {
      const t = mirrorMesh(m, rd);
      t._mirrorSrc = m;      // lets checks compare the twin's shape against the original
      meshes.push(t);
    }
  }
  const BUILDERS = { spike: buildSpike, curve: buildCurve, membrane: buildMembrane,
    paw: buildPaw, fin: (s2, p2) => buildFin(s2, p2, builtVols) };
  for (const p of spec.parts || []) {
    const label = p.name || `${p.type}@${p.host || 'ribs'}`;
    const sa = p.smooth_angle ?? defSmooth;
    // which volume is this part supposed to be growing out of? Either declared
    // via anchor.chain, or the chain that owns its host joint. checks.js needs
    // it to tell "buried in the host" from "floating next to the host".
    const hostChain = (p.anchor && p.anchor.chain)
      || (p.host && Object.keys(spec.chains || {}).find(c => (spec.chains[c] || []).includes(p.host)))
      || null;
    if (p.type === 'eye') {
      for (const m of buildEye(spec, p, builtVols)) {
        m.part = label; m.smoothAngle = sa; m.partType = p.type; m.hostChain = hostChain; meshes.push(m); }
    } else if (BUILDERS[p.type]) {
      const m = BUILDERS[p.type](spec, p);
      m.part = label; m.smoothAngle = sa; m.partType = p.type; m.hostChain = hostChain; meshes.push(m);
      if (p.mirrored) { const t = mirrorMesh(m, rd); t.part = label + '.R'; t._mirrorSrc = m;
        t.partType = p.type; t.hostChain = hostChain; meshes.push(t); }
    } else throw new Error(`unknown part type "${p.type}"`);
  }
  // attach material colors
  for (const m of meshes) {
    const pal = (spec.palette || {})[m.material];
    if (!pal) throw new Error(`material "${m.material}" not in palette`);
    m.color = pal.color; m.rough = pal.rough; m.metal = pal.metal;
  }
  applyShading(spec, meshes);
  return meshes;
}

// ── whole-body shading pass ────────────────────────────────────────────────
// ONE top-to-bottom value ramp and ONE grain size across the entire creature,
// applied to EVERY mesh — volumes, paws, ears, eyes, horns alike. Two reasons
// it lives here instead of inside each volume:
//   · the ramp is measured over the WHOLE body's Y range, so the same numbers
//     mean the same thing on an upright leg and a horizontal torso (per-volume
//     ranges forced the wolf to write bottom -0.16 on legs and -0.04 on the
//     torso to fake one consistent light);
//   · parts have no `colors` block at all, so under the old scheme paws, ears
//     and claws never received any shading and read as stickers on the body.
// Noise size is a FRACTION OF THE MODEL DIAGONAL, not an absolute distance:
// an absolute cell keeps its world size as the creature scales, so the same
// spec on a giant produced grain finer than the vertex spacing and aliased.
function applyShading(spec, meshes) {
  const sh = spec.shading || {};
  const grad = sh.gradient === undefined ? { top: 0.30, bottom: -0.88 } : sh.gradient;
  const nz = sh.noise === undefined ? { size: 0.018, amount: 0.26 } : sh.noise;
  if (!meshes.length) return;

  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const m of meshes) for (const v of m.V) for (let k = 0; k < 3; k++) {
    if (v[k] < lo[k]) lo[k] = v[k];
    if (v[k] > hi[k]) hi[k] = v[k];
  }
  const y0 = lo[1], y1 = hi[1] > lo[1] ? hi[1] : lo[1] + 1e-6;
  const diag = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
  const cell = nz && nz.amount ? (nz.size ?? 0.018) * diag : 0;
  const cl = x => Math.min(1, Math.max(0, x));

  for (const m of meshes) {
    if (!m.C) m.C = m.V.map(() => hex2lin(m.color || '#888888'));
    m.V.forEach((v, i) => {
      let c = m.C[i];
      if (grad) {
        const f = (v[1] - y0) / (y1 - y0);
        const k = 1 + (grad.top ?? 0) * f + (grad.bottom ?? 0) * (1 - f);
        c = [cl(c[0] * k), cl(c[1] * k), cl(c[2] * k)];
      }
      if (cell) {
        const k = 1 + (vnoise(v, cell) - 0.5) * 2 * nz.amount;
        c = [cl(c[0] * k), cl(c[1] * k), cl(c[2] * k)];
      }
      m.C[i] = c;
    });
  }
  INFO.push(`shading: body-Y ramp top ${(grad && grad.top) ?? 0} / bottom ${(grad && grad.bottom) ?? 0}`
    + (cell ? `, grain ${(cell).toFixed(4)} (${((nz.size ?? 0.018) * 100).toFixed(1)}% of the ${diag.toFixed(2)} diagonal)` : ', no grain')
    + ` — applied to all ${meshes.length} meshes`);
}

module.exports = { compile, drainInfo };
