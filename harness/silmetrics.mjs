// anyCreature — silhouette metrics tool. Author: Ariescar.
// The measuring half of the LOWRES loop. Renders the model as a pure-black
// silhouette (side + front), then computes the FLOOR numbers and the
// CHARACTER-AXIS numbers, plus the 24px thumbnail used by the blind-read gate.
//
//   node harness/silmetrics.mjs <model.glb> <outdir> [--prev <outdir_of_previous_round>]
//
// outputs in <outdir>:
//   sil_side.png / sil_front.png   640px silhouettes (human review)
//   thumb24.png                    24px silhouette, nearest-upscaled to 240px
//                                  → show ONLY this image to a context-free
//                                    blind reader; ask (1) "what is this?"
//                                    (2) "which part grabs the eye most?"
//                                    (3) "list the parts/features you can read"
//   sil_side.mask.json             packed mask (input for next round's --prev)
//   metrics.json                   all numbers, see below
//
// metrics.json:
//   W_over_H, fill, mass_thirds        — global mass layout
//   torso_depth_{min,max}, mass_contrast (max/min torso depth over mid-band)
//   leg_fraction                       — ground→belly gap at mid-body / H
//   turn_count                         — hard silhouette corners (>35°); LOW
//                                        turn_count = the "too round" disease
//   zigzag_alignment                   — fraction of top-contour bumps sitting
//                                        directly above a bottom-contour bump
//                                        (0 = staggered/good, 1 = stacked/stiff)
//   iou_vs_prev                        — regression guard (needs --prev)
//
// These are not pass/fail thresholds. The design card DECLARES a position per
// axis (tension targets); this tool verifies the declared position was reached.
import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path'; import http from 'http';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [modelPath, outDir] = process.argv.slice(2);
const prevIx = process.argv.indexOf('--prev');
const prevDir = prevIx > 0 ? process.argv[prevIx + 1] : null;
if (!modelPath || !outDir) { console.error('usage: node silmetrics.mjs <model.glb> <outdir> [--prev <prev outdir>]'); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });

const html = `<!doctype html><body style="margin:0"><script src="/bundle.js"></script><script>
const scene=new THREE.Scene(); scene.background=new THREE.Color(0xffffff);
const cam=new THREE.PerspectiveCamera(30,1,0.01,100);
const r=new THREE.WebGLRenderer({antialias:false,preserveDrawingBuffer:true}); r.setSize(640,640);
document.body.appendChild(r.domElement);
let cur=null;
window.load=(url)=>new Promise((res,rej)=>{ fetch(url).then(x=>x.arrayBuffer()).then(buf=>{
  new GLTFLoader().parse(buf,'',g=>{ cur=g.scene; scene.add(cur);
    cur.traverse(o=>{o.frustumCulled=false; if(o.isMesh)o.material=new THREE.MeshBasicMaterial({color:0,side:THREE.DoubleSide});});
    res(1);},e=>rej(String(e))); }); });
window.shoot=(view)=>{ const box=new THREE.Box3().setFromObject(cur),c=box.getCenter(new THREE.Vector3()),s=box.getSize(new THREE.Vector3());
  const long = s.x>s.z ? 'x':'z';
  let dir;
  if(view==='top'){ dir=[0,1,0]; cam.up.set(long==='x'?1:0, 0, long==='x'?0:1); }
  else if(view==='hero'){ cam.up.set(0,1,0); dir=[1,0.5,1]; }
  else { cam.up.set(0,1,0); dir = view==='side' ? (long==='x'?[0,0,1]:[1,0,0]) : (long==='x'?[1,0,0]:[0,0,1]); }
  const rad=Math.max(s.x,s.y,s.z);
  cam.position.copy(c).add(new THREE.Vector3(...dir).multiplyScalar(rad*2.4)); cam.lookAt(c);
  r.render(scene,cam);
  const g2=r.domElement.getContext('webgl2')||r.domElement.getContext('webgl');
  const px=new Uint8Array(640*640*4); g2.readPixels(0,0,640,640,g2.RGBA,g2.UNSIGNED_BYTE,px);
  let bits='';
  for(let y=639;y>=0;y--){ let acc=0,n=0;
    for(let x=0;x<640;x++){ acc=(acc<<1)|(px[(y*640+x)*4]<128?1:0); if(++n===6){bits+=String.fromCharCode(48+acc);acc=0;n=0;} }
    if(n)bits+=String.fromCharCode(48+(acc<<(6-n)));   // row-aligned: flush per row
  }
  return { bits, png: r.domElement.toDataURL('image/png') }; };
</script></body>`;

const srv = http.createServer((q, res) => {
  if (q.url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(html); }
  if (q.url === '/bundle.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(fs.readFileSync(path.join(here, 'assets/three-bundle.js'))); }
  if (q.url === '/model.glb') { res.writeHead(200); return res.end(fs.readFileSync(modelPath)); }
  res.writeHead(404); res.end();
});
// loopback only, and let the OS pick the port — a fixed port on 0.0.0.0
// exposed the page and the model to the whole network, and collided
// whenever two runs overlapped.
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;
// Let Playwright locate its own browser; PW_CHROMIUM_PATH pins it if needed.
const br = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    .concat(process.env.PW_NO_SANDBOX === '1' ? ['--no-sandbox'] : []) });
const pg = await br.newPage({ viewport: { width: 660, height: 660 } });
await pg.goto(`http://127.0.0.1:${port}/`);
await pg.evaluate(() => window.load('/model.glb'));
await pg.waitForTimeout(600);

function unpack(bits) {
  const m = Array.from({ length: 640 }, () => new Uint8Array(640));
  let i = 0;
  for (let y = 0; y < 640; y++) for (let x = 0; x < 640; x += 6) {
    const c = bits.charCodeAt(i++) - 48;
    for (let b = 0; b < 6 && x + b < 640; b++) m[y][x + b] = (c >> (5 - b)) & 1;
  }
  return m;
}
function bbox(m) {
  let y0 = 640, y1 = -1, x0 = 640, x1 = -1;
  for (let y = 0; y < 640; y++) for (let x = 0; x < 640; x++) if (m[y][x]) {
    if (y < y0) y0 = y; if (y > y1) y1 = y; if (x < x0) x0 = x; if (x > x1) x1 = x;
  }
  return { y0, y1, x0, x1 };
}
const shots = {};
for (const view of ['side', 'front', 'top', 'hero']) {
  const { bits, png } = await pg.evaluate(v => window.shoot(v), view);
  fs.writeFileSync(path.join(outDir, `sil_${view}.png`), Buffer.from(png.split(',')[1], 'base64'));
  shots[view] = unpack(bits);
}
await br.close(); srv.close();

// ── 24px thumbnail (nearest ×10) from the side mask ──
{
  const m = shots.side, b = bbox(m);
  const W = b.x1 - b.x0 + 1, H = b.y1 - b.y0 + 1, S = Math.max(W, H);
  const canvasPng = await (async () => {
    // tiny hand-rolled PNG: 240x240 grayscale via zlib store — use playwright page instead? keep simple: write PGM then let humans open PNGs; blind reader gets a PNG rendered from mask
    const px = 240; const img = Buffer.alloc(px * px, 255);
    for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
      const sx = b.x0 + Math.floor((Math.floor(x / 10) + 0.5) / 24 * S) - Math.floor((S - W) / 2);
      const sy = b.y0 + Math.floor((Math.floor(y / 10) + 0.5) / 24 * S) - Math.floor((S - H) / 2);
      let on = 0;
      if (sx >= 0 && sy >= 0 && sx < 640 && sy < 640) {
        // 24px cell = majority vote over the source block
        const cell = S / 24; let cnt = 0, tot = 0;
        for (let dy = 0; dy < cell; dy += 2) for (let dx = 0; dx < cell; dx += 2) {
          const yy = sy + Math.floor(dy - cell / 2), xx = sx + Math.floor(dx - cell / 2);
          if (yy >= 0 && xx >= 0 && yy < 640 && xx < 640) { tot++; cnt += m[yy][xx]; }
        }
        on = tot && cnt / tot > 0.35 ? 1 : 0;
      }
      if (on) img[y * px + x] = 0;
    }
    const zlib = await import('zlib');
    const raw = Buffer.alloc(px * (px + 1));
    for (let y = 0; y < px; y++) { raw[y * (px + 1)] = 0; img.copy(raw, y * (px + 1) + 1, y * px, (y + 1) * px); }
    const idat = zlib.deflateSync(raw);
    const crc = (buf) => { let c = ~0; for (const b2 of buf) { c ^= b2; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; };
    const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const cc = Buffer.alloc(4); cc.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cc]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(px, 0); ihdr.writeUInt32BE(px, 4); ihdr[8] = 8; ihdr[9] = 0;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
  })();
  fs.writeFileSync(path.join(outDir, 'thumb24.png'), canvasPng);
}

// ── metrics on the side mask ──
const m = shots.side, b = bbox(m);
const H = b.y1 - b.y0 + 1, W = b.x1 - b.x0 + 1;
const at = (y, x) => m[b.y0 + y] ? (m[b.y0 + y][b.x0 + x] || 0) : 0;
let area = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) area += at(y, x);
const thirds = [0, 1, 2].map(i => {
  let s = 0;
  for (let y = 0; y < H; y++) for (let x = Math.floor(i * W / 3); x < Math.floor((i + 1) * W / 3); x++) s += at(y, x);
  return +(s / area).toFixed(3);
});
// largest contiguous run per column = torso(+merged limb) depth
const runTop = new Array(W).fill(-1), runBot = new Array(W).fill(-1), runLen = new Array(W).fill(0);
for (let x = 0; x < W; x++) {
  let best = 0, bt = -1, bb = -1, s = -1;
  for (let y = 0; y <= H; y++) {
    const v = y < H ? at(y, x) : 0;
    if (v && s < 0) s = y;
    if (!v && s >= 0) { if (y - s > best) { best = y - s; bt = s; bb = y - 1; } s = -1; }
  }
  runTop[x] = bt; runBot[x] = bb; runLen[x] = best;
}
const band = runLen.slice(Math.floor(0.18 * W), Math.floor(0.82 * W)).filter(v => v > 0);
const dMax = Math.max(...band) / H, dMin = Math.min(...band) / H;
// leg fraction: columns whose run touches the bottom 3% are feet; take the gap
// between front and back foot groups, measure belly→ground there
const footCols = [];
for (let x = 0; x < W; x++) if (runBot[x] >= 0 && runBot[x] > H * 0.94 - 1) footCols.push(x);
let legFrac = null;
if (footCols.length) {
  // largest gap between consecutive foot columns = under-belly span
  let g0 = -1, g1 = -1, best = 0;
  for (let i = 1; i < footCols.length; i++) {
    const gap = footCols[i] - footCols[i - 1];
    if (gap > best) { best = gap; g0 = footCols[i - 1]; g1 = footCols[i]; }
  }
  if (best > 3) {
    const mid = Math.floor((g0 + g1) / 2);
    legFrac = +((H - 1 - runBot[mid]) / H).toFixed(3);
  }
}
// contour turn count (top + bottom boundary polylines)
function turnCount(boundary) {
  const ys = boundary.filter(v => v >= 0);
  if (ys.length < 20) return 0;
  const sm = ys.map((_, i) => {
    let s = 0, n = 0;
    for (let k = -2; k <= 2; k++) if (ys[i + k] !== undefined) { s += ys[i + k]; n++; }
    return s / n;
  });
  let count = 0, last = -10;
  const step = 4;
  for (let i = step; i < sm.length - step; i++) {
    const a = Math.atan2(sm[i] - sm[i - step], step), c = Math.atan2(sm[i + step] - sm[i], step);
    const d = Math.abs(c - a) * 180 / Math.PI;
    if (d > 35 && i - last > 8) { count++; last = i; }
  }
  return count;
}
const topB = new Array(W).fill(-1), botB = new Array(W).fill(-1);
for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (at(y, x)) { topB[x] = y; break; }
for (let x = 0; x < W; x++) for (let y = H - 1; y >= 0; y--) if (at(y, x)) { botB[x] = y; break; }
const turns = turnCount(topB) + turnCount(botB);
// zigzag alignment: top-contour extrema stacked over bottom-contour extrema?
function extrema(bd) {
  const out = [];
  for (let x = 6; x < W - 6; x++) {
    if (bd[x] < 0) continue;
    let isMin = true, isMax = true;
    for (let k = -6; k <= 6; k++) { if (bd[x + k] < 0) { isMin = isMax = false; break; }
      if (bd[x + k] < bd[x]) isMin = false; if (bd[x + k] > bd[x]) isMax = false; }
    if ((isMin || isMax) && (!out.length || x - out[out.length - 1] > 10)) out.push(x);
  }
  return out;
}
const te = extrema(topB), be = extrema(botB);
let stacked = 0;
for (const x of te) if (be.some(x2 => Math.abs(x2 - x) < 0.04 * W)) stacked++;
const zigzag = te.length ? +(stacked / te.length).toFixed(2) : 0;

// iou vs previous round
let iou = null;
if (prevDir) {
  const prev = unpack(JSON.parse(fs.readFileSync(path.join(prevDir, 'sil_side.mask.json'))).bits);
  const pb = bbox(prev);
  let inter = 0, uni = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const a = at(y, x);
    const py = pb.y0 + Math.floor(y * (pb.y1 - pb.y0 + 1) / H);
    const px2 = pb.x0 + Math.floor(x * (pb.x1 - pb.x0 + 1) / W);
    const p = prev[py] ? (prev[py][px2] || 0) : 0;
    if (a & p) inter++; if (a | p) uni++;
  }
  iou = +(inter / (uni || 1)).toFixed(3);
}

let repack = '';
for (let y = 0; y < 640; y++) for (let x = 0; x < 640; x += 6) {
  let c = 0; for (let bq = 0; bq < 6; bq++) c = (c << 1) | (x + bq < 640 ? m[y][x + bq] : 0);
  repack += String.fromCharCode(48 + c);
}
fs.writeFileSync(path.join(outDir, 'sil_side.mask.json'), JSON.stringify({ bits: repack }));
// per-view basics: identity must hold from every orthographic view, not one
const viewStats = {};
for (const view of ['front', 'top', 'hero']) {
  const mv = shots[view], bv = bbox(mv);
  if (bv.y1 < 0) { viewStats[view] = null; continue; }
  const Hv = bv.y1 - bv.y0 + 1, Wv = bv.x1 - bv.x0 + 1;
  let av = 0;
  for (let y = bv.y0; y <= bv.y1; y++) for (let x = bv.x0; x <= bv.x1; x++) av += mv[y][x];
  viewStats[view] = { W_over_H: +(Wv / Hv).toFixed(2), fill: +(av / (Wv * Hv)).toFixed(3) };
}
const metrics = {
  W_over_H: +(W / H).toFixed(2), fill: +(area / (W * H)).toFixed(3),
  mass_thirds: thirds, torso_depth_max: +dMax.toFixed(2), torso_depth_min: +dMin.toFixed(2),
  mass_contrast: +(dMax / (dMin || 1)).toFixed(2), leg_fraction: legFrac,
  turn_count: turns, zigzag_alignment: zigzag, iou_vs_prev: iou,
  front: viewStats.front, top: viewStats.top, hero: viewStats.hero,
};
fs.writeFileSync(path.join(outDir, 'metrics.json'), JSON.stringify(metrics, null, 1));
console.log(JSON.stringify(metrics));
