#!/usr/bin/env python3
"""Delivery packer (L1, zero handwork): stamped GLB + showroom viewer + hero shots + upload pack.

usage: python3 deliver.py <model.glb> <delivery_dir> <name>
                          [--title "Monster Name"] [--author "Signature"] [--gate gate.json]

outputs in <delivery_dir>:
  <name>.glb           final stamped model (identity written INTO the file)
  <name>_viewer.html   offline showroom (open by double-click, no server)
  hero.png / hero.jpg  1024² hero shots (transparent / studio grey)
  upload/              ready-to-drag backup pack for gobkit.com/community/upload

stamping (asset block):
  generator            anyCreature v<VERSION>
  copyright            --author (the creature's human, not the tool)
  extras.harness/.harness_version/.spec   tool identity
  extras.monster       --title (display name)
  extras.gate          --gate JSON, ONLY if it holds really-run check results
CC0 licence is NOT stamped here — publish.mjs adds it at upload, after consent.
"""
import sys, os, json, base64, struct, shutil, subprocess, html

HERE = os.path.dirname(os.path.abspath(__file__))

def read_version():
    for p in (os.path.join(HERE, '..', 'VERSION'), os.path.join(HERE, 'VERSION')):
        try:
            return open(p).read().strip()
        except OSError:
            pass
    return '0.0.0'

def parse_glb(raw):
    assert raw[:4] == b'glTF', 'need a binary .glb (compiler output)'
    jlen, jtype = struct.unpack('<II', raw[12:20])
    g = json.loads(raw[20:20 + jlen])
    bin_chunk = b''
    off = 20 + jlen
    if off < len(raw):
        blen, btype = struct.unpack('<II', raw[off:off + 8])
        bin_chunk = raw[off + 8: off + 8 + blen]
    return g, bin_chunk

def pack_glb(g, bin_chunk):
    js = json.dumps(g, separators=(',', ':')).encode()
    while len(js) % 4: js += b' '
    body = bytearray(bin_chunk)
    while len(body) % 4: body.append(0)
    total = 12 + 8 + len(js) + 8 + len(body)
    return (struct.pack('<4sII', b'glTF', 2, total)
            + struct.pack('<II', len(js), 0x4E4F534A) + js
            + struct.pack('<II', len(body), 0x004E4942) + bytes(body))

def stamp(g, name, title, author, gate):
    a = g.setdefault('asset', {})
    a['version'] = '2.0'
    a['generator'] = f'anyCreature v{read_version()}'
    if author: a['copyright'] = author
    x = a.setdefault('extras', {})
    x['harness'] = 'anyCreature'
    x['harness_version'] = read_version()
    x['spec'] = x.get('spec') or name
    if title: x['monster'] = title
    if gate: x['gate'] = gate
    return g

# The showroom layout lives in harness/assets/showroom.html so it can be
# redesigned without touching this file. Placeholders: __TITLE__ __BYLINE__
# __BUNDLE__ __B64__.
def read_showroom():
    return open(os.path.join(HERE, 'assets', 'showroom.html'), encoding='utf-8').read()


UPLOAD_README = """Backup upload path (no key, no account needed):
  1. open  https://gobkit.com/community/upload
  2. drag  creature.glb  into the page
Your monster's name and signature are already written inside the file, so the
listing will show them automatically. Uploads via this page go through a short
review before appearing. Uploading releases the model under CC0.
"""

def main():
    args = sys.argv[1:]
    def opt(flag):
        if flag in args:
            i = args.index(flag); v = args[i + 1]; del args[i:i + 2]; return v
        return None
    title, author, gatep = opt('--title'), opt('--author'), opt('--gate')
    if len(args) < 3:
        sys.exit('usage: python3 deliver.py <model.glb> <delivery_dir> <name> [--title T] [--author A] [--gate g.json]')
    src, outdir, name = args[0], args[1], args[2]
    os.makedirs(outdir, exist_ok=True)

    gate = None
    if gatep:
        gate = json.load(open(gatep))
        assert isinstance(gate, dict) and 'checks' in gate, 'gate.json must hold REAL check results ({passed, checks:[...]})'
        # A stamp claiming "passed" while listing a failure is worse than no stamp:
        # it is written into the GLB and travels onto the community wall. Seen in
        # the wild — a delivered model carried passed:true with mid_face_blindread
        # failed in the same object. Either fix the check or say it failed.
        failed = [c.get('name', '?') for c in gate['checks'] if not c.get('passed')]
        if failed and gate.get('passed'):
            raise SystemExit(
                '[deliver] REFUSED: gate.json says "passed": true but these checks failed: '
                + ', '.join(failed) + '.\n'
                '          The gate stamp is written into the model and travels with it forever.\n'
                '          Fix the check and re-run, or set "passed": false and deliver it honestly.')

    g, bin_chunk = parse_glb(open(src, 'rb').read())
    g = stamp(g, name, title, author, gate)
    glb = pack_glb(g, bin_chunk)
    glb_path = os.path.join(outdir, f'{name}.glb')
    open(glb_path, 'wb').write(glb)

    # showroom viewer
    bundle = open(os.path.join(HERE, 'assets', 'three-bundle.js'), encoding='utf-8').read()
    disp = title or name.replace('_', ' ').title()
    byline = (f'{author} · ' if author else '') + f'anyCreature {read_version()}'
    # The name and the signature come from a human and land inside markup, so
    # they are escaped before substitution. Unescaped, a creature called
    # `</h1><script>…` executed in the delivered viewer — and the same string
    # travels in the GLB to the community wall.
    page = (read_showroom().replace('__TITLE__', html.escape(disp, quote=True))
                  .replace('__BYLINE__', html.escape(byline, quote=True))
                  .replace('__BUNDLE__', bundle)
                  .replace('__B64__', base64.b64encode(glb).decode()))
    open(os.path.join(outdir, f'{name}_viewer.html'), 'w', encoding='utf-8').write(page)

    # hero shots (transparent + studio) — the hero NEVER shows the label card
    subprocess.run(['node', os.path.join(HERE, 'hero.mjs'), glb_path, outdir], check=True)

    # backup upload pack (web drag path)
    up = os.path.join(outdir, 'upload'); os.makedirs(up, exist_ok=True)
    shutil.copy(glb_path, os.path.join(up, 'creature.glb'))
    shutil.copy(os.path.join(outdir, 'hero.png'), os.path.join(up, 'hero.png'))
    open(os.path.join(up, 'README.txt'), 'w').write(UPLOAD_README)

    print(f'[deliver] done: {name}.glb · {name}_viewer.html · hero.png/jpg · upload/'
          f'\n[deliver] stamped: {disp}{" " + byline if byline else ""} · gate={"yes" if gate else "no"}'
          f'\n[deliver] checklist: glb, viewer, heroes, spec JSON, DEVLOG one-liner')

if __name__ == '__main__':
    main()
