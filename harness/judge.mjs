// Generic creature mechanical judge (engine layer, L1) — renders (silhouette / ID / beauty) + pure numeric measurement, zero LLM.
// The engine contains no creature-specific vocabulary; all identity claims live in the spec JSON.
//
// usage:  node judge.mjs <model.gltf|glb> <outDir> <name> [--spec creature.json] [--stage LOW|MID|HIGH]
//   no --spec = measure only, emit metrics JSON (for humans or for scoring)
//   with --spec = check every claim in the spec; any failure exits 1 (symptom-first messages)
//
// spec JSON = { "name": "...", "claims": [ {type, ...params, "label": "plain-language description"} ] }
// Supported claim types (add a new one in CHECKS; keep the engine creature-agnostic):
//   part_exists     {part}                      — a material/part with this name must exist
//   part_visible    {part, view?, min_share}    — minimum share of body pixels the part holds in a given view
//   part_signature  {part, view?, min_share, or_min_span} — signature part: share OR span ratio must clear its bar
//   style_dark      {view?, max_median_lum}     — dark styling: body median luminance must not exceed the cap
//   style_light     {view?, min_median_lum}     — light styling: must not fall below the floor
//   rig_skinned     {}                          — must be skinned (bones move nothing without skin weights)
//   anim_named      {names:[...]}               — these named animations must be present
//   tri_budget      {min, max}                  — triangle budget band
//   share_hierarchy {primary:[..],secondary:[..],tertiary:[..],view?,tolerance?} — primary/secondary/tertiary shares ≈6:3:1
//   focal_contrast  {a, b, view?, min_ratio?}   — the two focal parts' shares must differ by ≥N× (default 2)
//   saturation_area {view?, min?, max?}         — share of the view carrying a highly saturated colour
//                                                 (HSV S ≥ 0.50 on the UNLIT baked colour). Default band
//                                                 0.10–0.34. Says how much, never where.
import { chromium } from 'playwright';
import path from 'path'; import fs from 'fs'; import http from 'http';
import { fileURLToPath } from 'url';

const args = process.argv.slice(2);
const si = args.indexOf('--spec');
const specFile = si >= 0 ? args.splice(si, 2)[1] : null;
const sti = args.indexOf('--stage');
const stageFilter = sti >= 0 ? args.splice(sti, 2)[1].toUpperCase() : null; // LOW/MID/HIGH; none = check all
const [src, outDir, name] = args;
if (!src || !outDir || !name) { console.error('usage: node judge.mjs <model> <outDir> <name> [--spec spec.json]'); process.exit(2); }
const root = path.dirname(fileURLToPath(import.meta.url));
const abs = path.resolve(src);
fs.mkdirSync(outDir, { recursive: true });

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js",
"three/addons/":"/node_modules/three/examples/jsm/"}}</script></head><body style="margin:0">
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const W=512,H=512;
const r=new THREE.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});
r.setSize(W,H); r.setPixelRatio(1); document.body.appendChild(r.domElement);
const scene=new THREE.Scene(); scene.background=new THREE.Color(0xffffff);
const gltf=await new GLTFLoader().loadAsync('/__model');
const model=gltf.scene; scene.add(model);
const anims=(gltf.animations||[]).map(a=>a.name);
let skins=0; model.traverse(o=>{ if(o.isSkinnedMesh) skins++; });

const groups=new Map();
model.traverse(o=>{ if(!o.isMesh) return;
  const mats=Array.isArray(o.material)?o.material:[o.material];
  const n=(mats[0]?.name||'unnamed').toLowerCase();
  if(!groups.has(n)) groups.set(n,[]);
  groups.get(n).push(o); });
const names=[...groups.keys()];
const idMat=new Map();
names.forEach((n,i)=>{ const id=i+1;
  idMat.set(n,new THREE.MeshBasicMaterial({color:new THREE.Color((id&3)/3,((id>>2)&3)/3,((id>>4)&3)/3),side:THREE.DoubleSide})); });
const idRGB=names.map((n,i)=>{const id=i+1;return [Math.round((id&3)/3*255),Math.round(((id>>2)&3)/3*255),Math.round(((id>>4)&3)/3*255)];});

// per-group world bbox (skinned parts use undeformed vertices ≈ rest pose)
const gb={};
for(const [n,ms] of groups){ const b=new THREE.Box3();
  for(const m of ms){ m.updateWorldMatrix(true,false);
    const pos=m.geometry.attributes.position; const idx=m.geometry.index; const v=new THREE.Vector3();
    // ★ Measure only the vertices the index actually references — glTF primitives often share one POSITION accessor;
    //   scanning attributes directly measures every group's bbox as the whole body.
    if(idx){ const seen=new Set();
      for(let i=0;i<idx.count;i++){ const k=idx.getX(i); if(seen.has(k))continue; seen.add(k);
        v.fromBufferAttribute(pos,k).applyMatrix4(m.matrixWorld); b.expandByPoint(v); } }
    else for(let i=0;i<pos.count;i++){ v.fromBufferAttribute(pos,i).applyMatrix4(m.matrixWorld); b.expandByPoint(v); } }
  gb[n]={min:b.min.toArray(),max:b.max.toArray()}; }
const box=new THREE.Box3().setFromObject(model);
const size=box.getSize(new THREE.Vector3()), c=box.getCenter(new THREE.Vector3());
const rad=Math.max(size.x,size.y,size.z);
const cam=new THREE.PerspectiveCamera(35,1,rad*0.01,rad*100);
const VIEWS={front:[0,0.12,1],side:[1,0.12,0],tq:[0.8,0.3,0.8],reartq:[-0.8,0.3,-0.8],top:[0.02,1,0.02]};

const cv=document.createElement('canvas'); cv.width=W; cv.height=H;
const cx=cv.getContext('2d',{willReadFrequently:true});
function grab(){ cx.drawImage(r.domElement,0,0); return cx.getImageData(0,0,W,H).data; }
function shoot(analyze){ const out={},px={};
  for(const [vn,v] of Object.entries(VIEWS)){
    const d=new THREE.Vector3(...v).normalize().multiplyScalar(rad*2.5);
    cam.position.copy(c).add(d); cam.lookAt(c); cam.updateProjectionMatrix();
    r.render(scene,cam); out[vn]=r.domElement.toDataURL('image/png');
    if(analyze) px[vn]=analyze(grab()); }
  return {out,px}; }

// 1) beauty (original materials + lights, sRGB = what the display actually shows) → measure luminance
r.outputColorSpace=THREE.SRGBColorSpace;
const hemi=new THREE.HemisphereLight(0xffffff,0x888877,0.9);
const key=new THREE.DirectionalLight(0xffffff,1.6); key.position.set(2,3,2);
const fill=new THREE.DirectionalLight(0xffffff,0.5); fill.position.set(-2,1,-1);
scene.add(hemi,key,fill);
const beauty=shoot(d=>{ const lums=[];
  for(let i=0;i<d.length;i+=4){ const R=d[i],G=d[i+1],B=d[i+2];
    if(R>248&&G>248&&B>248) continue;             // white background
    lums.push(0.2126*R+0.7152*G+0.0722*B); }
  lums.sort((a,b)=>a-b);
  return {bodyPx:lums.length, medianLum:lums.length?lums[Math.floor(lums.length/2)]:255}; });
scene.remove(hemi,key,fill);
r.outputColorSpace=THREE.LinearSRGBColorSpace;

// 1b) albedo — the baked vertex colours with NO lighting, so saturation can be
// measured independently of brightness. gradient, grain and AO are all uniform
// multiplies, so they move a pixel's value but never its HSV saturation; lights
// do move it (a white key washes colour out, a blue rim invents it). Measuring
// here is the only way "how much of this creature is highly saturated" comes out
// as an honest area rather than a lighting artefact.
r.outputColorSpace=THREE.SRGBColorSpace;
const albedoMat=new Map();
model.traverse(o=>{ if(o.isMesh){ albedoMat.set(o,o.material);
  o.material=new THREE.MeshBasicMaterial({vertexColors:!!o.geometry.attributes.color,
    color:o.geometry.attributes.color?0xffffff:(o.material.color?o.material.color.clone():0xffffff),
    side:THREE.DoubleSide}); }});
const albedo=shoot(d=>{ let body=0,hi=0;
  for(let i=0;i<d.length;i+=4){ const R=d[i],G=d[i+1],B=d[i+2];
    if(R>248&&G>248&&B>248) continue;             // white background
    body++;
    const mx=Math.max(R,G,B), mn=Math.min(R,G,B);
    if(mx>0 && (mx-mn)/mx>=0.50) hi++; }          // HSV saturation ≥ 0.50
  return {bodyPx:body, hiSatPx:hi, hiSatShare: body? hi/body : 0}; });
model.traverse(o=>{ if(o.isMesh) o.material=albedoMat.get(o); });
r.outputColorSpace=THREE.LinearSRGBColorSpace;

// 2) silhouette
const orig=new Map();
model.traverse(o=>{ if(o.isMesh){ orig.set(o,o.material);
  o.material=new THREE.MeshBasicMaterial({color:0x000000,side:THREE.DoubleSide}); }});
const sil=shoot(null);
// 3) ID buffer → per-material pixel counts per view
for(const [n,ms] of groups) for(const m of ms) m.material=idMat.get(n);
const ids=shoot(d=>{ const cnt={}; let body=0;
  for(let i=0;i<d.length;i+=4){ const R=d[i],G=d[i+1],B=d[i+2];
    if(R>248&&G>248&&B>248) continue; body++;
    for(let k=0;k<idRGB.length;k++){ const t=idRGB[k];
      if(Math.abs(R-t[0])<28&&Math.abs(G-t[1])<28&&Math.abs(B-t[2])<28){ cnt[names[k]]=(cnt[names[k]]||0)+1; break; } } }
  return {bodyPx:body,counts:cnt}; });
model.traverse(o=>{ if(o.isMesh) o.material=orig.get(o); });

let tris=0; model.traverse(o=>{ if(o.isMesh){ const g=o.geometry.index;
  tris += g? g.count/3 : o.geometry.attributes.position.count/3; }});
window.__r={ beauty:beauty.out, sil:sil.out, ids:ids.out, albedo:albedo.out,
  lum:beauty.px, idpx:ids.px, sat:albedo.px,
  names, gbox:gb, wbox:{min:box.min.toArray(),max:box.max.toArray()},
  stats:{triangles:Math.round(tris), skinnedMeshes:skins, animations:anims} };
window.__done=true;
</script></body></html>`;

// Static file serving is CONFINED. `path.join(base, urlPath)` is not safe:
// a raw request line carrying "/../../../../etc/passwd" (fetch normalises it,
// a socket does not) escaped every base and served the file, and the listener
// was bound to 0.0.0.0 — arbitrary file read from anywhere on the network,
// /proc/self/environ included. Resolve, then require containment, then allow
// only the extensions the page actually imports.
const OK_EXT = new Set(['.js', '.mjs', '.map', '.json', '.wasm']);
const BASES = [path.dirname(abs), root, path.join(root, '..')].map(b => path.resolve(b));
function safeResolve(urlPath) {
  for (const base of BASES) {
    const f = path.resolve(base, '.' + urlPath);
    if (f !== base && !f.startsWith(base + path.sep)) continue;   // escaped the base
    if (!OK_EXT.has(path.extname(f))) continue;
    try { if (fs.statSync(f).isFile()) return f; } catch {}
  }
  return null;
}
const server = http.createServer((req,res)=>{
  let p; try { p = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); return res.end(); }
  if(p==='/'){res.writeHead(200,{'Content-Type':'text/html'});return res.end(PAGE);}
  if(p==='/__model'){res.writeHead(200,{'Content-Type':'model/gltf+json'});return res.end(fs.readFileSync(abs));}
  const f = safeResolve(p);
  if(f){res.writeHead(200,{'Content-Type':'text/javascript'});return res.end(fs.readFileSync(f));}
  res.writeHead(404);res.end();
});
// loopback only — nothing here is meant to be reachable from the network
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const port=server.address().port;
// Let Playwright find its own browser. A hardcoded container path breaks every
// clone on macOS/Windows; PW_CHROMIUM_PATH stays available for pinned setups.
const exe = process.env.PW_CHROMIUM_PATH || undefined;
// --no-sandbox drops a real defence and is only needed where the OS sandbox is
// unavailable (docker without SYS_ADMIN, CI images). Opt in, never by default.
const launchArgs=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'];
if(process.env.PW_NO_SANDBOX==='1') launchArgs.push('--no-sandbox');
const browser=await chromium.launch({executablePath:exe,args:launchArgs});
const page=await browser.newPage({viewport:{width:560,height:560}});
const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
await page.goto(`http://127.0.0.1:${port}/`);
try{ await page.waitForFunction('window.__done===true',{timeout:120000}); }
catch(e){ console.error('FAILED\n'+errs.join('\n')); await browser.close(); server.close(); process.exit(2); }
const R=await page.evaluate('window.__r');
for(const [vn,d] of Object.entries(R.sil)) fs.writeFileSync(path.join(outDir,`${name}_sil_${vn}.png`),Buffer.from(d.split(',')[1],'base64'));
for(const [vn,d] of Object.entries(R.ids)) fs.writeFileSync(path.join(outDir,`${name}_id_${vn}.png`),Buffer.from(d.split(',')[1],'base64'));
for(const [vn,d] of Object.entries(R.beauty)) fs.writeFileSync(path.join(outDir,`${name}_beauty_${vn}.png`),Buffer.from(d.split(',')[1],'base64'));

// ── Export measurements (every part measured; no name filtering) ──
const sz=b=>[b.max[0]-b.min[0],b.max[1]-b.min[1],b.max[2]-b.min[2]];
const diagXZ=s=>Math.hypot(s[0],s[2]);
const whole=sz(R.wbox);
const share=(vn,mat)=>{ const p=R.idpx[vn]; return p.bodyPx? (p.counts[mat]||0)/p.bodyPx : 0; };
const parts={};
for(const n of R.names){ const b=R.gbox[n]; if(!b) continue; const s=sz(b);
  parts[n]={ size:s,
    share:Object.fromEntries(Object.keys(R.idpx).map(vn=>[vn,+share(vn,n).toFixed(5)])),
    span_ratio:+(diagXZ(s)/(diagXZ(whole)||1)).toFixed(4),
    height_ratio:+(s[1]/(whole[1]||1)).toFixed(4) }; }
const m={ name, stats:R.stats, names:R.names,
  lum:Object.fromEntries(Object.entries(R.lum).map(([vn,x])=>[vn,+x.medianLum.toFixed(1)])),
  hi_sat_share:Object.fromEntries(Object.entries(R.sat).map(([vn,x])=>[vn,+x.hiSatShare.toFixed(4)])),
  parts, whole:{size:whole} };
fs.writeFileSync(path.join(outDir,`${name}_metrics.json`),JSON.stringify(m,null,1));
console.log(JSON.stringify(m));

// ── Spec mode: check every claim, symptom first ──
if(specFile){
  const S=JSON.parse(fs.readFileSync(specFile,'utf8'));
  const bad=[];
  const pct=x=>(x*100).toFixed(2)+'%';
  const CHECKS={
    part_exists(c){ if(!R.names.includes(c.part))
      bad.push(`Part "${c.part}" not measurable: no material by that name in the model (part missing, or naming convention not followed)`); },
    part_visible(c){ if(!R.names.includes(c.part)) return CHECKS.part_exists(c);
      const v=c.view||'side'; const s=share(v,c.part);
      if(s<c.min_share) bad.push(`Part "${c.part}" is nearly invisible in the ${v} view (share ${pct(s)} < ${pct(c.min_share)}) — occluded, too small, or in the wrong place`); },
    part_signature(c){ if(!R.names.includes(c.part)) return CHECKS.part_exists(c);
      const v=c.view||'side'; const s=share(v,c.part); const sp=parts[c.part].span_ratio;
      if(!(s>=c.min_share||sp>=c.or_min_span))
        bad.push(`Signature part \"${c.part}\" is not exaggerated enough: ${v}-view share ${pct(s)} (need ≥${pct(c.min_share)}) and span ratio ${sp} (need ≥${c.or_min_span}) — right now it is just another part; it cannot carry this creature's identity`); },
    style_dark(c){ const v=c.view||'side'; const L=R.lum[v].medianLum;
      if(L>c.max_median_lum) bad.push(`Declared dark but does not read dark on screen: ${v}-view body median luminance ${L.toFixed(0)}/255 (need ≤${c.max_median_lum}) — push the material colour values darker`); },
    style_light(c){ const v=c.view||'side'; const L=R.lum[v].medianLum;
      if(L<c.min_median_lum) bad.push(`Declared light but reads too dark on screen: ${v}-view body median luminance ${L.toFixed(0)}/255 (need ≥${c.min_median_lum})`); },
    // High-saturation AREA, measured on the unlit baked colour (HSV S ≥ 0.50).
    // Too little and the creature is a grey lump; too much and saturation stops
    // being a spotlight and the whole thing screams. Do NOT name which surfaces
    // carry it — where the colour goes is the designer's call, only how much.
    saturation_area(c){ const v=c.view||'tq';
      const s=R.sat[v]; if(!s) return;
      const pct=s.hiSatShare*100, lo=(c.min??0.10)*100, hi=(c.max??0.34)*100;
      if(pct<lo) bad.push(`Too little colour: only ${pct.toFixed(1)}% of the ${v} view is highly saturated (need ≥${lo.toFixed(0)}%) — the creature reads as a grey mass. Raise the saturation of a mass that deserves the attention, do not tint everything.`);
      if(pct>hi) bad.push(`Too much colour: ${pct.toFixed(1)}% of the ${v} view is highly saturated (need ≤${hi.toFixed(0)}%) — saturation stops reading as a spotlight when it covers this much. Desaturate the supporting masses and keep the loud colour on the signature.`); },
    rig_skinned(){ if(R.stats.skinnedMeshes<1)
      bad.push('Model is not skinned: the rig is not bound to the mesh, so animating the bones moves nothing'); },
    anim_named(c){ for(const a of c.names) if(!R.stats.animations.includes(a))
      bad.push(`Missing named animation ${a} (present: ${R.stats.animations.join(',')||'none'})`); },
    tri_budget(c){ const t=R.stats.triangles;
      if(t<c.min||t>c.max) bad.push(`Triangle count ${t} is outside the budget band ${c.min}–${c.max}`); },
    // 6:3:1 hierarchy: the primary / secondary / tertiary part groups must hold roughly
    // 6:3:1 of the frame. An even spread reads as no hierarchy at all — a silhouette needs
    // one mass that clearly leads, one that supports, and detail that stays detail.
    share_hierarchy(c){ const v=c.view||'side';
      const grp=g=>g.reduce((a,p)=>a+(R.names.includes(p)?share(v,p):0),0);
      const [P,S,T]=[grp(c.primary||[]),grp(c.secondary||[]),grp(c.tertiary||[])];
      const tot=P+S+T; if(!tot){ bad.push(`631 hierarchy not measurable: primary/secondary/tertiary parts are all 0 in the ${v} view`); return; }
      const tol=c.tolerance??0.15, want=[0.6,0.3,0.1], got=[P/tot,S/tot,T/tot];
      const off=got.map((g,i)=>Math.abs(g-want[i]));
      if(Math.max(...off)>tol) bad.push(`Hierarchy ratio off: primary/secondary/tertiary = ${got.map(x=>(x*100).toFixed(0)).join(':')} (target 60:30:10, tolerance ±${tol*100}%) — no dominance; the frame is split evenly`); },
    // No equal-weight focal points: two focal parts of the same size make the eye ping-pong
    // between them and neither one wins. The declared pair's shares must differ by ≥ratio×.
    focal_contrast(c){ const v=c.view||'side';
      for(const p of [c.a,c.b]) if(!R.names.includes(p)) return CHECKS.part_exists({part:p});
      const A=share(v,c.a), B=share(v,c.b); const hi=Math.max(A,B), lo=Math.min(A,B);
      const ratio=c.min_ratio??2;
      if(lo>0 && hi/lo<ratio) bad.push(`Two focal points of equal weight compete: "${c.a}" ${(A*100).toFixed(1)}% vs "${c.b}" ${(B*100).toFixed(1)}% (need ≥${ratio}× apart) — the eye ping-pongs between them; open up the dominance gap`); },
  };
  const claims=(S.claims||[]).filter(c=>!stageFilter || !c.stage || c.stage.toUpperCase()===stageFilter);
  for(const c of claims){
    const fn=CHECKS[c.type];
    if(!fn){ bad.push(`Spec contains a claim type the engine does not recognise: "${c.type}"`); continue; }
    const before=bad.length; fn(c);
    if(bad.length>before && c.label) bad[bad.length-1] += ` [${c.label}]`;
  }
  if(bad.length){ console.log('\n'+'='.repeat(68));
    console.log(`BLOCKING — against spec "${S.name||path.basename(specFile)}", the following fail and must be fixed:`);
    for(const b of bad) console.log('  ✗ '+b);
    console.log('='.repeat(68)+`\n${bad.length} blocking item(s). exit 1 — cannot ship.`);
    await browser.close(); server.close(); process.exit(1); }
  console.log(`[judge] Spec \"${S.name||''}\" — all claims pass.`);
}
await browser.close(); server.close();
