#!/usr/bin/env node
// ACS engine CLI. Author: Ariescar.
// usage: node cli.js <spec.json> <out.glb>
// Compiles the spec, runs all mechanical checks (any failure = exit 1, build
// blocked), then writes a skinned+animated GLB. Errors are structured and
// agent-readable: one line each, prefixed BLOCK:.
'use strict';
const fs = require('fs');
const { compile } = require('./core/compile.js');
const { buildSkeleton, inverseBindMatrices } = require('./core/skeleton.js');
const { compileAnims } = require('./core/anim.js');
const { runChecks } = require('./core/checks.js');
const { writeGLB } = require('./core/glb.js');

const [specPath, outPath] = process.argv.slice(2);
if (!specPath || !outPath) { console.error('usage: node cli.js <spec.json> <out.glb>'); process.exit(2); }

const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
require('./core/relative.js').resolveJoints(spec);  // relational joints → coordinates
const sk = buildSkeleton(spec);          // also registers mirrored chains
const meshes = compile(spec);
for (const line of require('./core/compile.js').drainInfo())
  console.error('info: ' + line);        // the compiler narrates what happened
const { fails, warns } = runChecks(spec, sk, meshes, null);
for (const w of warns) console.error('warn: ' + w);   // measures, not laws — you judge
if (fails.length) {
  console.error('='.repeat(68));
  for (const f of fails) console.error('BLOCK: ' + f);
  console.error('='.repeat(68));
  console.error(`${fails.length} blocking issue(s) — build refused.`);
  process.exit(1);
}
const anims = compileAnims(spec, sk);
// UV atlas is opt-in ("keep_uv": true): without textures TEXCOORD_0 is dead
// weight in the shipped file, and AO now bakes into vertex colours instead
const uvInfo = spec.keep_uv ? require('./core/uv.js').applyUVs(meshes) : null;
const aoInfo = require('./core/ao.js').bakeAO(meshes, spec.ao); // vertex AO → COLOR_0 (ao:false skips)
// public identity: harness stamp + convention bone names (internal names stay authoring-side)
let hv = '0.0.0';
for (const vp of ['..', '.']) {
  try { hv = fs.readFileSync(require('path').join(__dirname, vp, 'VERSION'), 'utf8').trim(); break; } catch {}
}
const specName = require('path').basename(specPath).replace(/\.json$/, '');
const asset = {
  generator: `anyCreature v${hv}`,
  extras: { harness: 'anyCreature', harness_version: hv, spec: specName },
};
const names = require('./core/skeleton.js').exportNames(spec, sk);
const bytes = writeGLB({ meshes, skeleton: sk, ibm: inverseBindMatrices(sk), anims }, outPath,
  { asset, names });
const tv = meshes.reduce((a, m) => a + m.V.length, 0);
const tf = meshes.reduce((a, m) => a + m.F.length, 0);
console.log(JSON.stringify({ ok: true, out: outPath, bytes,
  verts: tv, faces: tf, joints: sk.joints.length,
  anims: anims.map(a => a.name), checks: 'all green',
  uv: uvInfo ? { islands: uvInfo.islands, atlasUtil: +uvInfo.atlasUtil.toFixed(2) } : 'off',
  ao: aoInfo.baked ? { meanOcc: +aoInfo.meanOcc.toFixed(3) } : 'off' }));
