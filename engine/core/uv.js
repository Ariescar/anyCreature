// ACS engine — UV unwrap + global atlas. Author: Ariescar.
// Game-ready TEXCOORD_0: every primitive unwrapped into non-overlapping
// islands, all islands shelf-packed into ONE 0..1 atlas at uniform world
// texel density → a single AO/lightmap bake covers the whole creature.
//
//  tube volumes  → cylindrical (u = around-angle × circumference, v = arc length)
//                  + each end cap as its own planar island; wrap seam gets
//                  duplicated vertices (no smeared triangle across the seam)
//  everything else (paw/fin/eye/spike…) → box unwrap: faces grouped by the
//                  dominant axis of their normal (6 islands), planar projected
//
// Runs AFTER checks, BEFORE the GLB writer. Mutates meshes: vertices are
// duplicated along island borders/seams (V, C, skin, F rebuilt; UV added).
'use strict';
const G = require('./geometry.js');

function faceNormal(V, f) {
  const n = [0, 0, 0];
  for (let i = 1; i < f.length - 1; i++) {
    const x = G.cross(G.sub(V[f[i]], V[f[0]]), G.sub(V[f[i + 1]], V[f[0]]));
    n[0] += x[0]; n[1] += x[1]; n[2] += x[2];
  }
  return n;
}

// Rebuild one mesh from a list of islands; each island = {faces, proj(vi)->[u,v], wrap?}
// proj returns WORLD-scaled uv so texel density is uniform everywhere.
function rebuild(m, islands) {
  const newV = [], newUV = [], newF = [];
  const newC = m.C ? [] : null, newS = m.skin ? [] : null;
  const rects = [];
  for (const isl of islands) {
    if (!isl.faces.length) continue;
    const start = newV.length;
    const map = new Map();
    const emit = (vi, shifted) => {
      const key = shifted ? vi + 0.5 : vi;
      if (!map.has(key)) {
        map.set(key, newV.length);
        newV.push(m.V[vi]);
        if (newC) newC.push(m.C[vi]);
        if (newS) newS.push(m.skin[vi]);
        const [u, v] = isl.proj(vi);
        newUV.push([u + (shifted ? isl.wrap : 0), v]);
      }
      return map.get(key);
    };
    for (const f of isl.faces) {
      let shifts = f.map(() => false);
      if (isl.wrap) {
        const us = f.map(vi => isl.proj(vi)[0]);
        if (Math.max(...us) - Math.min(...us) > isl.wrap / 2)
          shifts = us.map(u => u < isl.wrap / 2);
      }
      newF.push(f.map((vi, i) => emit(vi, shifts[i])));
    }
    rects.push({ start, end: newV.length });
  }
  m.V = newV; m.F = newF; m.UV = newUV;
  if (newC) m.C = newC; if (newS) m.skin = newS;
  return rects.map(r => ({ mesh: m, ...r }));
}

function volumeIslands(m) {
  const ringOf = new Map();
  m._ringIdx.forEach((idx, s) => idx.forEach((vi, k) => ringOf.set(vi, [s, k])));
  const N = m._sides;
  // world scale: circumference of the mean ring, and total path length
  let rbar = 0, cnt = 0;
  m._ringIdx.forEach((idx, s) => {
    const c = m._pts[s];
    for (const vi of idx) { rbar += G.len(G.sub(m.V[vi], c)); cnt++; }
  });
  rbar /= cnt || 1;
  const circ = 2 * Math.PI * rbar;
  let L = 0;
  for (let i = 1; i < m._pts.length; i++) L += G.len(G.sub(m._pts[i], m._pts[i - 1]));
  const tube = [], cap0 = [], cap1 = [];
  for (const f of m.F) {
    if (f.every(vi => ringOf.has(vi))) { tube.push(f); continue; }
    const touches0 = f.some(vi => ringOf.has(vi) && ringOf.get(vi)[0] === 0);
    (touches0 ? cap0 : cap1).push(f);
  }
  const tubeProj = vi => {
    const [s, k] = ringOf.get(vi);
    return [(k / N) * circ, m._ringT[s] * L];
  };
  const capProj = (endS) => {
    const c = m._pts[endS];
    const other = m._pts[endS === 0 ? Math.min(1, m._pts.length - 1) : endS - 1];
    const nrm = G.nrm(G.sub(c, other));
    let e1 = Math.abs(nrm[1]) < 0.9 ? G.nrm(G.cross(nrm, [0, 1, 0])) : [1, 0, 0];
    const e2 = G.nrm(G.cross(nrm, e1));
    return vi => {
      const d = G.sub(m.V[vi], c);
      return [G.dot(d, e1), G.dot(d, e2)];
    };
  };
  return [
    { faces: tube, proj: tubeProj, wrap: circ },
    { faces: cap0, proj: capProj(0) },
    { faces: cap1, proj: capProj(m._pts.length - 1) },
  ];
}

function boxIslands(m) {
  const groups = [[], [], [], [], [], []]; // +x -x +y -y +z -z
  for (const f of m.F) {
    const n = faceNormal(m.V, f);
    const a = [Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2])];
    const ax = a[0] >= a[1] && a[0] >= a[2] ? 0 : a[1] >= a[2] ? 1 : 2;
    groups[ax * 2 + (n[ax] >= 0 ? 0 : 1)].push(f);
  }
  const projFor = gi => {
    const ax = Math.floor(gi / 2), sign = gi % 2 === 0 ? 1 : -1;
    const u = (ax + 1) % 3, v = (ax + 2) % 3;
    return vi => [m.V[vi][u] * sign, m.V[vi][v]];
  };
  return groups.map((faces, gi) => ({ faces, proj: projFor(gi) }));
}

function applyUVs(meshes) {
  const rects = [];
  for (const m of meshes) {
    const islands = (m._ringIdx && m._pts) ? volumeIslands(m) : boxIslands(m);
    rects.push(...rebuild(m, islands));
  }
  // measure islands in world units
  let totalArea = 0;
  for (const r of rects) {
    const uv = r.mesh.UV;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (let i = r.start; i < r.end; i++) {
      const [u, v] = uv[i];
      if (u < u0) u0 = u; if (u > u1) u1 = u;
      if (v < v0) v0 = v; if (v > v1) v1 = v;
    }
    r.u0 = u0; r.v0 = v0; r.w = Math.max(u1 - u0, 1e-6); r.h = Math.max(v1 - v0, 1e-6);
    totalArea += r.w * r.h;
  }
  // shelf pack (height-sorted) with padding, into a roughly square atlas
  const pad = 0.015 * Math.sqrt(totalArea);
  const targetW = Math.sqrt(totalArea) * 1.25;
  const sorted = rects.slice().sort((a, b) => b.h - a.h);
  let x = pad, y = pad, rowH = 0, atlasW = 0;
  for (const r of sorted) {
    if (x + r.w + pad > targetW && x > pad) { y += rowH + pad; x = pad; rowH = 0; }
    r.px = x; r.py = y;
    x += r.w + pad;
    if (r.h > rowH) rowH = r.h;
    if (x > atlasW) atlasW = x;
  }
  const atlasH = y + rowH + pad;
  const S = Math.max(atlasW, atlasH);
  // write back normalised 0..1 uv
  for (const r of rects) {
    const uv = r.mesh.UV;
    for (let i = r.start; i < r.end; i++) {
      uv[i] = [(uv[i][0] - r.u0 + r.px) / S, (uv[i][1] - r.v0 + r.py) / S];
    }
  }
  return { islands: rects.length, atlasUtil: totalArea / (S * S) };
}

module.exports = { applyUVs };
