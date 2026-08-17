# 04 SHIP (scripted delivery + closing dialogue + optional community publish)

## Red lines (absolute)

- **Never upload anything without the user's explicit YES, this session.**
  Not to test, not in the background, not because a card says the flow exists.
- **Ask about sharing for every creature**, even if the user shared the last one.
- **Once they say yes, RUN the upload. Always try it first.** Do not decide in
  advance that this environment cannot reach the network — cloud sandboxes,
  Cowork sessions and CI runners frequently can. Run `publish.mjs`, then answer
  from what it printed. ❌ "in a sandbox you can only upload manually" — never
  say this. ✅ "try the upload, fall back to the link if it fails."
- The web page `gobkit.com/community/upload` is the BACKUP path only, and it is
  offered ONLY after a real attempt came back `blocked`.

## 1. Gate stamp (real results only)

Serialize the checks you actually ran into `delivery/gate.json`:

```json
{ "passed": true, "checks": [ {"name":"anim_integrity","passed":true},
  {"name":"attack_reach","passed":true}, {"name":"faceted_body","passed":true},
  {"name":"saturation_area","passed":true}, {"name":"gate1_recognised","passed":true},
  {"name":"gate2_punchier","passed":true} ] }
```

Never invent a line. If a check didn't run, it isn't in the file.

## 2. Names, then delivery

Ask in the USER'S language, exactly two questions, in this order (they name it
and sign it BEFORE any talk of sharing — ownership first):

> Give your monster a name? (Enter = <working name>)
> Your signature? Asked once — auto-filled from now on. (Enter = anonymous)

The signature question is skipped when `~/.anyCreature.json` exists — read
`{"author": "..."}` from it; on first answer, write it there.

```bash
python3 harness/deliver.py out/<name>.glb delivery/ <name> \
        --title "<their name>" --author "<signature>" --gate delivery/gate.json
```

This stamps name + signature + gate INTO the GLB (`asset.copyright`,
`extras.monster` — they travel with the file forever), then packs: stamped
`.glb`, offline showroom `_viewer.html`, `hero.png`/`hero.jpg` (auto-framed,
no label card in shot), and `upload/` (the backup pack). Confirm the viewer
opens. Echo one line:

> "<Name>" by <signature> — written into the model.

## 3. The share ask (LAST, after they've seen their name on it)

> Share it to the Gobkit community? Uploading releases it under CC0, permanently —
> anyone can download, use and remix it.  [yes / no]

That one sentence IS the licence consent — no legal recital. On **no**: reply
"All files are in delivery/ — say the word if you ever want to share it." and
STOP. On **yes**:

```bash
node harness/publish.mjs delivery/<name>.glb delivery/hero.png \
     --title "<their name>" --creator "<signature>"
```

**`hero.png` is not optional.** A submission without an image is not rejected,
but it will not list automatically — it sits waiting for a human reviewer. That
is the one common reason a creature stalls after a successful upload. Pass it
every time.

It re-stamps `extras.license = CC0-1.0` (consent just given) and POSTs to the
endpoint in `harness/gobkit.json`. One JSON line comes back — answer from it,
using the SERVER's title/creator (what the wall actually shows):

| result | tell the user (their language, one line) |
|---|---|
| `published` | ✅ Published: "<title>" by <creator> → <share_url> |
| `pending_review` | ⚠ Uploaded — a reviewer is checking it; it will appear shortly. (no further explanation) |
| `blocked` | The upload pack is ready in `delivery/upload/` — open https://gobkit.com/community/upload and drag `creature.glb` in. No account, no key needed. (state it as the next step, NOT as an error — nothing is broken and nothing was lost) |
| `error` | The server answered and refused — read its message out verbatim, then offer the same backup page. |

**Reading a `blocked` result.** The submit endpoint always answers in JSON, so
an **HTTP 403 is a filtered network, never a key problem** — 403 is not one of
the endpoint's own answers. A non-JSON body means a proxy or captive portal
replied instead of the server. `publish.mjs` already classifies all of these as
`blocked`; do not re-diagnose them as authentication failures, and never tell
the user to fetch or change a key.

## 4. Closing ledger

One DEVLOG line (format in card 00) + the delivery checklist: glb, viewer,
heroes, spec JSON, gate.json, DEVLOG.
