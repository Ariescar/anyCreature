// ACS engine — cross-section vocabulary. Author: Ariescar.
// Rich ring generation on top of the frame math (framesOf lineage):
//   exp  — superellipse exponent: 2 = ellipse, 3-6 = boxy slab, 1.2-1.6 = diamond-ish
//   bias — vertical asymmetry: +0.3 = egg (fuller on top), -0.3 = keel (fuller below)
//   roll — rotate the section in its plane (radians)
// Per-ring overrides allowed via the profile row: [t, w, h, {exp,bias,roll}]
'use strict';
const G = require('./geometry.js');

function sectionPoint(a, rw, rh, exp, bias) {
  const c = Math.cos(a), s = Math.sin(a);
  const e = 2 / (exp || 2);
  let x = Math.sign(c) * Math.pow(Math.abs(c), e) * rw;
  let y = Math.sign(s) * Math.pow(Math.abs(s), e) * rh;
  if (bias) y *= s > 0 ? (1 + bias) : (1 - bias);
  return [x, y];
}

// named custom section: closed 2D polygon [[x,y]...] in ~unit space, sampled
// by angle position around the list. Concave relief — bark flutes, crescents,
// star sections — has to be built as real geometry: a texture can darken a
// groove but never moves the silhouette, and the silhouette is what gets read.
function polyPoint(pts, a, rw, rh) {
  const n = pts.length;
  const f = (((a / (2 * Math.PI)) % 1) + 1) % 1 * n;
  const i = Math.floor(f) % n, j = (i + 1) % n, t = f - Math.floor(f);
  return [(pts[i][0] + (pts[j][0] - pts[i][0]) * t) * rw,
          (pts[i][1] + (pts[j][1] - pts[i][1]) * t) * rh];
}

// pts: chain joints; radii: [[rw,rh],...] per joint; secs: [{exp,bias,roll}] per joint
function chainRingsRich(pts, radii, N, frame, secs) {
  const { fr } = require('./geometry.js').framesOf
    ? require('./geometry.js').framesOf(pts, frame)
    : (() => { throw new Error('framesOf missing'); })();
  const rings = [];
  for (let s = 0; s < pts.length; s++) {
    const [U, W] = fr[s];
    const [rw, rh] = Array.isArray(radii[s]) ? radii[s] : [radii[s], radii[s]];
    const sec = secs[s] || {};
    const ring = [];
    for (let k = 0; k < N; k++) {
      const a = 2 * Math.PI * k / N + (sec.roll || 0);
      const [x, y] = sec.pts ? polyPoint(sec.pts, a, rw, rh)
                             : sectionPoint(a, rw, rh, sec.exp, sec.bias);
      ring.push(G.add(pts[s], G.add(G.mul(U, x), G.mul(W, y))));
    }
    rings.push(ring);
  }
  return rings;
}

module.exports = { chainRingsRich, sectionPoint, polyPoint };
