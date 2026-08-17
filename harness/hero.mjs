// anyCreature — hero shot renderer. Author: Ariescar.
// Renders the delivery hero images from the final GLB:
//   hero.png   1024×1024, TRANSPARENT background, 45° three-quarter view,
//              idle mid-frame, ≥8% margin on every side (nothing cropped)
//   hero.jpg   same shot over the studio grey backdrop
// usage: node harness/hero.mjs <model.glb> <outdir>
import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path'; import http from 'http';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [modelPath, outDir] = process.argv.slice(2);
if (!modelPath || !outDir) { console.error('usage: node hero.mjs <model.glb> <outdir>'); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });

const html = `<!doctype html><body style="margin:0;background:transparent"><script src="/bundle.js"></script><script>
const S=1024;
const scene=new THREE.Scene(); scene.background=null;
const cam=new THREE.PerspectiveCamera(32,1,0.01,500);
const r=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});
r.setSize(S,S); r.outputColorSpace=THREE.SRGBColorSpace; document.body.appendChild(r.domElement);
scene.add(new THREE.HemisphereLight(0xffffff,0x8a8578,1.5));
const key=new THREE.DirectionalLight(0xffffff,2.4); key.position.set(3,4,2.5); scene.add(key);
const fill=new THREE.DirectionalLight(0xcfd8ff,1.0); fill.position.set(-4,1.5,2); scene.add(fill);
const rim=new THREE.DirectionalLight(0xaac4ff,1.6); rim.position.set(-2.5,2.5,-4); scene.add(rim);
let cur=null,mixer=null,anims=[];
window.load=(url)=>new Promise((res,rej)=>{ fetch(url).then(x=>x.arrayBuffer()).then(buf=>{
  new GLTFLoader().parse(buf,'',g=>{ cur=g.scene; scene.add(cur);
    cur.traverse(o=>{o.frustumCulled=false});
    anims=g.animations||[];
    const idle=anims.find(a=>a.name==='idle');
    if(idle){ mixer=new THREE.AnimationMixer(cur);
      mixer.clipAction(idle).play(); mixer.update(idle.duration*0.3); }
    res(1);},e=>rej(String(e))); }); });
window.shoot=(dist,panX,panY)=>{ const box=new THREE.Box3().setFromObject(cur),
  c=box.getCenter(new THREE.Vector3()), sz=box.getSize(new THREE.Vector3());
  const rad=Math.max(sz.x,sz.y,sz.z);
  cam.position.copy(c).add(new THREE.Vector3(1,0.5,1).normalize().multiplyScalar(rad*dist));
  cam.lookAt(c);
  if(panX||panY){ // recentre: shift camera AND target along camera right/up
    const right=new THREE.Vector3().setFromMatrixColumn(cam.matrix,0);
    const up=new THREE.Vector3().setFromMatrixColumn(cam.matrix,1);
    const off=right.multiplyScalar(panX).add(up.multiplyScalar(panY));
    cam.position.add(off); c.add(off); cam.lookAt(c);
  }
  r.render(scene,cam);
  const g2=r.domElement.getContext('webgl2')||r.domElement.getContext('webgl');
  const px=new Uint8Array(S*S*4); g2.readPixels(0,0,S,S,g2.RGBA,g2.UNSIGNED_BYTE,px);
  let x0=S,x1=-1,y0=S,y1=-1;
  for(let y=0;y<S;y++)for(let x=0;x<S;x++) if(px[(y*S+x)*4+3]>8){
    if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; }
  const camDist=rad*dist, half=camDist*Math.tan(cam.fov/2*Math.PI/180);
  return { png:r.domElement.toDataURL('image/png'),
           frac: x1<0?0:Math.max(x1-x0+1,y1-y0+1)/S,
           // gl reads y-up, matching NDC — world offset of the alpha centre
           ndcX:((x0+x1)/2-S/2)/(S/2)*half, ndcY:((y0+y1)/2-S/2)/(S/2)*half };
};
window.jpg=()=>{ const cv=document.createElement('canvas'); cv.width=cv.height=S;
  const ctx=cv.getContext('2d'); ctx.fillStyle='#4c4c51'; ctx.fillRect(0,0,S,S);
  ctx.drawImage(r.domElement,0,0); return cv.toDataURL('image/jpeg',0.92); };
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
const pg = await br.newPage({ viewport: { width: 1044, height: 1044 } });
await pg.goto(`http://127.0.0.1:${port}/`);
await pg.evaluate(() => window.load('/model.glb'));
await pg.waitForTimeout(500);

// iterative fit: rescale so the long side is 84%, then pan the camera so the
// alpha bbox centres — both re-measured, so margins land ≥8% on every side
let dist = 2.6, panX = 0, panY = 0;
let shot = await pg.evaluate(a => window.shoot(a.d, a.x, a.y), { d: dist, x: 0, y: 0 });
for (let i = 0; i < 3 && shot.frac > 0.01; i++) {
  dist = dist * shot.frac / 0.83;
  panX += shot.ndcX; panY += shot.ndcY;
  shot = await pg.evaluate(a => window.shoot(a.d, a.x, a.y), { d: dist, x: panX, y: panY });
  if (Math.abs(shot.frac - 0.83) < 0.02 && Math.hypot(shot.ndcX, shot.ndcY) < 0.01) break;
}
const jpg = await pg.evaluate(() => window.jpg());
await br.close(); srv.close();

fs.writeFileSync(path.join(outDir, 'hero.png'), Buffer.from(shot.png.split(',')[1], 'base64'));
fs.writeFileSync(path.join(outDir, 'hero.jpg'), Buffer.from(jpg.split(',')[1], 'base64'));
console.log(JSON.stringify({ ok: true, margin: +((1 - shot.frac) / 2 * 100).toFixed(1) + 0 }));
