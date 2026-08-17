// ACS engine — animation compiler. Author: Ariescar.
// Agent-first keyframes: degrees + fractions, engine turns them into
// glTF rotation/translation samplers. Mirrored chains get phase-shifted,
// axis-flipped copies of the L tracks automatically.
//
// spec.animations = {
//   move: { duration: 1.0, loop: true, mirror_phase: 0.5,
//           tracks: { LLegRoot: { rx: [[0,-25],[0.5,25],[1,-25]] },
//                     Hips:     { ty: [[0,0],[0.25,0.04],[0.5,0]] } } }
// }
// rx/ry/rz = rotation degrees around local X/Y/Z; tx/ty/tz = translation offset.
'use strict';
const { mirrorName } = require('./skeleton.js');

function eulerToQuat(rx, ry, rz) { // XYZ order, degrees
  const d = Math.PI / 180;
  const [x, y, z] = [rx * d / 2, ry * d / 2, rz * d / 2];
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(x), Math.sin(x), Math.cos(y), Math.sin(y), Math.cos(z), Math.sin(z)];
  return [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ];
}

function sampleKeys(keys, t) { // keys [[frac, val]...] sorted; linear interp, t in [0,1]
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, v0] = keys[i], [t1, v1] = keys[i + 1];
    if (t <= t1) { const f = (t - t0) / (t1 - t0 || 1); return v0 + (v1 - v0) * f; }
  }
  return keys[keys.length - 1][1];
}

// Expand one animation into per-joint uniform samplers (N samples across duration).
// Returns { name, duration, channels: [{joint, path:'rotation'|'translation', times:[], values:[]}] }
function compileAnim(name, a, spec, sk, samples = 24) {
  const tracks = { ...a.tracks };
  // auto-mirror: for each track on a joint belonging to a mirrored chain,
  // add the R-side twin with phase shift + axis flip (ry, rz, tx negate).
  const phase = a.mirror_phase ?? 0;
  for (const cn of spec.mirror || []) {
    for (const jn of spec.chains[cn]) {
      if (!tracks[jn]) continue;
      const rj = mirrorName(jn);
      if (tracks[rj]) continue; // author overrode
      const src = tracks[jn]; const dst = {};
      for (const [axis, keys] of Object.entries(src)) {
        const flip = (axis === 'ry' || axis === 'rz' || axis === 'tx') ? -1 : 1;
        dst[axis] = keys.map(([t, v]) => [(t + phase) % 1, v * flip])
                        .sort((p, q) => p[0] - q[0]);
        // re-close the loop
        if (dst[axis][0][0] !== 0) dst[axis].unshift([0, sampleKeys(src[axis].map(([t,v])=>[(t+phase)%1, v*flip]).sort((p,q)=>p[0]-q[0]), 0)]);
        if (dst[axis][dst[axis].length-1][0] !== 1) dst[axis].push([1, dst[axis][0][1]]);
      }
      tracks[rj] = dst;
    }
  }
  const channels = [];
  const times = Array.from({ length: samples + 1 }, (_, i) => (i / samples) * a.duration);
  for (const [jn, tr] of Object.entries(tracks)) {
    if (!(jn in sk.index)) throw new Error(`animation "${name}" targets unknown joint "${jn}"`);
    const hasRot = tr.rx || tr.ry || tr.rz;
    const hasTrn = tr.tx || tr.ty || tr.tz;
    if (hasRot) {
      const values = [];
      for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        values.push(...eulerToQuat(
          tr.rx ? sampleKeys(tr.rx, t) : 0,
          tr.ry ? sampleKeys(tr.ry, t) : 0,
          tr.rz ? sampleKeys(tr.rz, t) : 0));
      }
      channels.push({ joint: jn, path: 'rotation', times, values });
    }
    if (hasTrn) {
      const base = require('./skeleton.js').localTranslations(sk)[sk.index[jn]];
      const values = [];
      for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        values.push(
          base[0] + (tr.tx ? sampleKeys(tr.tx, t) : 0),
          base[1] + (tr.ty ? sampleKeys(tr.ty, t) : 0),
          base[2] + (tr.tz ? sampleKeys(tr.tz, t) : 0));
      }
      channels.push({ joint: jn, path: 'translation', times, values });
    }
  }
  return { name, duration: a.duration, channels };
}

function compileAnims(spec, sk) {
  return Object.entries(spec.animations || {}).map(([n, a]) => compileAnim(n, a, spec, sk));
}

module.exports = { compileAnims, eulerToQuat, sampleKeys };
