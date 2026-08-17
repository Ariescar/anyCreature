# Security notes

## What this package runs on your machine

`silmetrics.mjs`, `hero.mjs` and `judge.mjs` each start a short-lived local HTTP
server so a headless Chromium can load the model, then shut it down. All three
**bind to `127.0.0.1` on an OS-assigned port** — they are not reachable from the
network, and two runs cannot collide on a port.

`judge.mjs` also serves the JavaScript its measuring page imports. Paths are
resolved and then checked for containment inside the allowed roots, and only
`.js .mjs .map .json .wasm` are served. Before 1.2.0 this used `path.join` with
no containment check and listened on `0.0.0.0`, which allowed any host on the
same network to read arbitrary files — `/etc/passwd` and `/proc/self/environ`
among them — for as long as a judge run lasted. If you are on an older copy,
update or do not run it on an untrusted network.

Chromium is launched **with the OS sandbox enabled**. Set `PW_NO_SANDBOX=1` only
where the sandbox genuinely cannot work (a container without the required
privileges). `PW_CHROMIUM_PATH` pins a browser binary if you need to; otherwise
Playwright picks its own.

## The Gobkit key in `harness/gobkit.json`

Public by design. It is an anonymous submission key for the community wall — it
authorises posting, nothing else, and abuse is bounded server-side by rate
limiting and review. Finding it in this repository is not a leak.

It does mean two things:

- **Rotation does not retract.** A key committed to git stays readable in the
  history forever. Retiring one has to happen server-side.
- The endpoint is effectively open to anyone who clones this repo, so the
  server's rate limiting and moderation are the only real controls.

## Untrusted input

Creature names and signatures come from a human and are written into three
places: the delivered `_viewer.html`, the GLB's `asset.copyright` /
`extras.monster`, and the community listing. `deliver.py` HTML-escapes them
before substitution — a creature named `</h1><script>…` used to execute in the
viewer. **Any service rendering `extras.monster` must escape it independently.**
Do not rely on this package having done it.

Spec JSON is executed as data, not code — there is no `eval`, no dynamic
`require`, and the only subprocess calls are fixed argument lists to `node`.
Nothing in the pipeline fetches a URL except `publish.mjs`, and only after
explicit consent.

## Reporting

Open a GitHub issue for anything non-sensitive. For something exploitable,
please report privately first.
