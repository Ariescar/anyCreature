// anyCreature — Gobkit community publisher. Author: Ariescar.
//
// IRON RULE: run this ONLY after the user has explicitly said yes to sharing.
// Never on your own initiative, never in the background, never "to test".
//
//   node harness/publish.mjs <model.glb> <hero.png> --title "Name" --creator "Signature"
//
// ── ALWAYS TRY THE UPLOAD FIRST ───────────────────────────────────────────────
// Never decide in advance that the environment cannot reach the network. Cloud
// sandboxes, Cowork sessions and CI runners frequently CAN. Run this command,
// then answer from what it prints. Telling the user "in this environment you
// have to upload by hand" WITHOUT having tried is wrong, and it is the most
// common way a finished creature never reaches the wall.
//
// ── THE THUMBNAIL IS NOT OPTIONAL ─────────────────────────────────────────────
// Always pass hero.png. A submission without an image is NOT rejected, but it
// will not list automatically — it waits for a human reviewer. A missing image
// is the one common reason a creature stalls after a successful upload.
//
// What it does, in order:
//   1. re-stamps the GLB: extras.license = CC0-1.0 (consent just given),
//      extras.monster / asset.copyright refreshed from --title / --creator
//   2. POSTs multipart to the endpoint in harness/gobkit.json
//      fields: model, thumb, title, creator_name, channel, key
//   3. prints ONE machine-readable JSON line:
//        {"status":"published","share_url":"https://gobkit.com/s/…","title":…,"creator":…}
//        {"status":"pending_review"}     → uploaded; a reviewer lists it shortly
//        {"status":"blocked","reason":…} → could not reach the server. NOT an error,
//                                          NOT a key problem — offer the backup path.
//        {"status":"error",…}            → the server answered and refused; read it out.
//
// ── HOW TO READ A FAILURE ─────────────────────────────────────────────────────
// The submit endpoint ALWAYS answers in JSON. Therefore:
//   · HTTP 403              → something between you and the server refused the
//                             request. It is a filtered network, NOT a bad key;
//                             403 is not one of the endpoint's own answers.
//   · a non-JSON body       → a proxy, captive portal or corporate filter replied
//                             instead of the server. Blocked.
//   · a transport exception → blocked.
// "blocked" is a normal outcome, not a failed run. Tell the user the upload pack
// is ready and give them the drag-and-drop page — no account, no key needed.
import fs from 'fs'; import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (f) => { const i = args.indexOf(f); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const title = opt('--title'), creator = opt('--creator');
const [glbPath, heroPath] = args;
if (!glbPath) {
  console.error('usage: node publish.mjs <model.glb> <hero.png> --title "Name" --creator "Signature"');
  process.exit(2);
}

const cfg = JSON.parse(fs.readFileSync(path.join(here, 'gobkit.json'), 'utf8'));
const endpoint = process.env.GOBKIT_ENDPOINT || cfg.endpoint;

// ── 1. consent stamp: licence + final naming into the file itself ──
const raw = fs.readFileSync(glbPath);
const jlen = raw.readUInt32LE(12);
const g = JSON.parse(raw.slice(20, 20 + jlen).toString());
const rest = raw.slice(20 + jlen);
const a = g.asset = g.asset || { version: '2.0' };
if (creator) a.copyright = creator;
const x = a.extras = a.extras || {};
if (title) x.monster = title;
x.license = 'CC0-1.0';
let js = Buffer.from(JSON.stringify(g)); while (js.length % 4) js = Buffer.concat([js, Buffer.from(' ')]);
const head = Buffer.alloc(12); head.write('glTF'); head.writeUInt32LE(2, 4);
const jh = Buffer.alloc(8); jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4E4F534A, 4);
const out = Buffer.concat([head, jh, js, rest]);
out.writeUInt32LE(out.length, 8);
fs.writeFileSync(glbPath, out);

// ── 2. multipart POST ──
const form = new FormData();
form.append('model', new Blob([out], { type: 'model/gltf-binary' }), path.basename(glbPath));
let hasThumb = false;
if (heroPath && fs.existsSync(heroPath)) {
  form.append('thumb', new Blob([fs.readFileSync(heroPath)], { type: 'image/png' }), 'hero.png');
  hasThumb = true;
} else {
  console.error('warn: no hero.png attached — the upload will be accepted but waits for a human '
    + 'reviewer instead of listing automatically. Pass delivery/hero.png.');
}
if (title) form.append('title', title);
if (creator) form.append('creator_name', creator);
form.append('channel', cfg.channel || 'harness');
form.append('key', cfg.key || '');

const blocked = (reason) => {
  console.log(JSON.stringify({ status: 'blocked', reason, thumb: hasThumb }));
  process.exit(0);
};

let res, body;
try {
  res = await fetch(endpoint, { method: 'POST', body: form, signal: AbortSignal.timeout(60000) });
} catch (e) {
  blocked('cannot reach the server: ' + String((e && e.message) || e));
}
// 403 is never one of this endpoint's answers — an intermediary produced it.
// Same for any body that is not JSON.
if (res.status === 403) blocked('HTTP 403 from an intermediary — the network is filtered, not the key');
try {
  body = await res.json();
} catch {
  blocked(`HTTP ${res.status} with a non-JSON body — a proxy or filter answered instead of the server`);
}

// ── 3. one JSON line for the closing dialogue ──
if ((res.status === 200 || res.status === 201) && body.ok && body.status === 'published') {
  const share = body.share_url?.startsWith('http') ? body.share_url : 'https://gobkit.com' + (body.share_url || '');
  console.log(JSON.stringify({ status: 'published', share_url: share,
    title: body.title ?? title, creator: body.creator ?? creator, thumb: hasThumb }));
} else if (body.ok && body.status === 'pending_review') {
  console.log(JSON.stringify({ status: 'pending_review', thumb: hasThumb }));
} else {
  console.log(JSON.stringify({ status: 'error', http: res.status, error: body.error || 'unexpected response' }));
}
