// ACS engine — vertex normals with a smoothing angle. Author: Ariescar.
//
// Two entry points, both ANGLE-weighted (each face contributes in proportion to
// the corner angle it subtends at the vertex, not to its area). Area weighting
// lets one big skinny triangle drag a normal off by tens of degrees, and because
// AO bakes from these normals the error lands in the shipped vertex colours.
//
//   vertexNormals(V, tris)               → one normal per vertex, fully smooth.
//                                          Used by the AO bake (it only needs a
//                                          hemisphere axis, never a crease).
//   smoothSplit(V, tris, deg, attrs)     → normals WITH creases: faces meeting at
//                                          a vertex are grouped by dihedral angle,
//                                          and the vertex is duplicated only when
//                                          it genuinely carries more than one
//                                          smoothing group. deg <= 0 = every face
//                                          its own group (the old `faceted`).
//
// Splitting only at real creases is the point: a 50° default leaves an organic
// mass fully smooth while keeping `sharp` profile breaks and plate rims crisp,
// and it costs a handful of extra vertices instead of tripling the mesh.
'use strict';

function faceData(V, tris) {
  const fn = [], ang = [];
  for (const [a, b, c] of tris) {
    const A = V[a], B = V[b], C = V[c];
    const u = [B[0]-A[0], B[1]-A[1], B[2]-A[2]];
    const w = [C[0]-A[0], C[1]-A[1], C[2]-A[2]];
    const n = [u[1]*w[2]-u[2]*w[1], u[2]*w[0]-u[0]*w[2], u[0]*w[1]-u[1]*w[0]];
    const l = Math.hypot(n[0], n[1], n[2]);
    fn.push(l > 1e-12 ? [n[0]/l, n[1]/l, n[2]/l] : null);   // null = degenerate
    const corner = (p, q, r) => {
      const e1 = [q[0]-p[0], q[1]-p[1], q[2]-p[2]];
      const e2 = [r[0]-p[0], r[1]-p[1], r[2]-p[2]];
      const l1 = Math.hypot(e1[0], e1[1], e1[2]), l2 = Math.hypot(e2[0], e2[1], e2[2]);
      if (l1 < 1e-12 || l2 < 1e-12) return 0;
      const d = (e1[0]*e2[0] + e1[1]*e2[1] + e1[2]*e2[2]) / (l1 * l2);
      return Math.acos(Math.max(-1, Math.min(1, d)));
    };
    ang.push([corner(A, B, C), corner(B, C, A), corner(C, A, B)]);
  }
  return { fn, ang };
}

function incidence(vcount, tris) {
  const inc = Array.from({ length: vcount }, () => []);
  tris.forEach((t, ti) => t.forEach((v, k) => inc[v].push([ti, k])));
  return inc;
}

function vertexNormals(V, tris) {
  const { fn, ang } = faceData(V, tris);
  const N = V.map(() => [0, 0, 0]);
  tris.forEach((t, ti) => {
    const n = fn[ti]; if (!n) return;
    t.forEach((v, k) => {
      const w = ang[ti][k];
      N[v][0] += n[0]*w; N[v][1] += n[1]*w; N[v][2] += n[2]*w;
    });
  });
  return N.map(n => { const l = Math.hypot(n[0], n[1], n[2]); return l > 1e-12 ? [n[0]/l, n[1]/l, n[2]/l] : [0, 1, 0]; });
}

// group a vertex's incident faces: two faces join when their normals sit within
// `deg` of each other (transitively — a fan that turns gradually stays one group,
// a `sharp` break with no face bridging it does not).
function groupFaces(list, fn, cosT) {
  const p = list.map((_, i) => i);
  const find = i => { while (p[i] !== i) { p[i] = p[p[i]]; i = p[i]; } return i; };
  for (let i = 0; i < list.length; i++) {
    const a = fn[list[i][0]]; if (!a) continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = fn[list[j][0]]; if (!b) continue;
      if (a[0]*b[0] + a[1]*b[1] + a[2]*b[2] >= cosT) {
        const ra = find(i), rb = find(j); if (ra !== rb) p[ra] = rb;
      }
    }
  }
  const byRoot = new Map();
  list.forEach((_, i) => {
    const r = find(i);
    if (!byRoot.has(r)) byRoot.set(r, []);
    byRoot.get(r).push(i);
  });
  return [...byRoot.values()];
}

// attrs: { C?, skin?, UV? } parallel arrays that must follow any vertex split.
// Returns { V, tris, N, C, skin, UV, split } — arrays are NEW, inputs untouched.
function smoothSplit(V, tris, deg, attrs = {}) {
  const { fn, ang } = faceData(V, tris);
  const inc = incidence(V.length, tris);
  const cosT = Math.cos(Math.max(0, Math.min(180, deg)) * Math.PI / 180);
  const hard = !(deg > 0);

  const outV = V.map(v => v);
  const outC = attrs.C ? attrs.C.map(c => c) : null;
  const outS = attrs.skin ? attrs.skin.map(s => s) : null;
  const outU = attrs.UV ? attrs.UV.map(u => u) : null;
  const outT = tris.map(t => t.slice());
  const N = V.map(() => null);
  let split = 0;

  for (let v = 0; v < V.length; v++) {
    const list = inc[v];
    if (!list.length) { N[v] = [0, 1, 0]; continue; }
    const groups = hard ? list.map(x => [list.indexOf(x)]) : groupFaces(list, fn, cosT);
    groups.forEach((gi, gidx) => {
      let acc = [0, 0, 0];
      for (const i of gi) {
        const [ti, k] = list[i]; const n = fn[ti]; if (!n) continue;
        const w = ang[ti][k];
        acc = [acc[0] + n[0]*w, acc[1] + n[1]*w, acc[2] + n[2]*w];
      }
      const l = Math.hypot(acc[0], acc[1], acc[2]);
      const nn = l > 1e-12 ? [acc[0]/l, acc[1]/l, acc[2]/l]
                           : (fn[list[gi[0]][0]] || [0, 1, 0]);
      if (gidx === 0) { N[v] = nn; return; }
      // second and later smoothing groups get their own copy of the vertex
      const nv = outV.length;
      outV.push(V[v]); N.push(nn); split++;
      if (outC) outC.push(attrs.C[v]);
      if (outS) outS.push(attrs.skin[v]);
      if (outU) outU.push(attrs.UV[v]);
      for (const i of gi) { const [ti, k] = list[i]; outT[ti][k] = nv; }
    });
  }
  return { V: outV, tris: outT, N, C: outC, skin: outS, UV: outU, split };
}

module.exports = { vertexNormals, smoothSplit };
