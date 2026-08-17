// ACS engine — relational joint resolver. Author: Ariescar.
// Lets specs express the skeleton in PROPORTIONS (segment offsets) instead of
// raw world coordinates. Absolute [x,y,z] stays legal everywhere.
//
//   "Spine":  {"from": "Hips",  "fwd": 0.47, "up": 0.01}      offset form
//   "TailTip":{"from": "Tail2", "dir": [0,-0.9,-0.35], "len": 0.34}  dir+len form
//   "LToe":   {"from": "LWrist","fwd": 0.14, "ground": 0.035} ground = absolute Y
//
// fwd = +z, up = +y, side = +x. "ground" overrides Y after the offset (for feet).
// Resolution is order-independent (iterates until fixed point); cycles throw.
// Idempotent: already-resolved arrays pass through untouched.
'use strict';
const G = require('./geometry.js');

function resolveJoints(spec) {
  const J = spec.joints;
  let pending = Object.keys(J).filter(n => !Array.isArray(J[n]));
  let guard = pending.length + 1;
  while (pending.length && guard-- > 0) {
    const next = [];
    for (const name of pending) {
      const d = J[name];
      const base = J[d.from];
      if (!base) throw new Error(`joint "${name}": "from" references unknown joint "${d.from}"`);
      if (!Array.isArray(base)) { next.push(name); continue; } // dependency not ready yet
      let p;
      if (d.dir && d.len !== undefined) p = G.add(base, G.mul(G.nrm(d.dir), d.len));
      else p = [base[0] + (d.side || 0), base[1] + (d.up || 0), base[2] + (d.fwd || 0)];
      if (d.ground !== undefined) p[1] = d.ground;
      J[name] = p;
    }
    if (next.length === pending.length)
      throw new Error(`joint dependency cycle: ${next.join(', ')}`);
    pending = next;
  }
  if (pending.length) throw new Error(`unresolvable joints: ${pending.join(', ')}`);

  // Optional right-side pose overrides: "joints_R" repositions auto-mirrored
  // R* joints AFTER the default mirror, so paired parts grow symmetric but the
  // bind pose can stagger (raised right arm, turned right wing). Same forms as
  // "joints"; "from" may reference any resolved joint or another joints_R entry.
  if (spec.joints_R) {
    const R = spec.joints_R;
    const look = n => Array.isArray(R[n]) ? R[n] : (Array.isArray(J[n]) ? J[n] : null);
    let pend = Object.keys(R).filter(n => !Array.isArray(R[n]));
    let g2 = pend.length + 1;
    while (pend.length && g2-- > 0) {
      const next = [];
      for (const name of pend) {
        const d = R[name];
        const base = look(d.from);
        if (!base) { next.push(name); continue; }
        let p;
        if (d.dir && d.len !== undefined) p = G.add(base, G.mul(G.nrm(d.dir), d.len));
        else p = [base[0] + (d.side || 0), base[1] + (d.up || 0), base[2] + (d.fwd || 0)];
        if (d.ground !== undefined) p[1] = d.ground;
        R[name] = p;
      }
      if (next.length === pend.length) throw new Error(`joints_R dependency cycle: ${next.join(', ')}`);
      pend = next;
    }
    if (pend.length) throw new Error(`unresolvable joints_R: ${pend.join(', ')}`);
  }
  return spec;
}

module.exports = { resolveJoints };
