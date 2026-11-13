# gemini-lumitome — v0.1.1

Gemini Web (your Google accounts, incl. Pro) → Lumitome / OpenCode, in the
simplest way that respects Lumitome's own rule: **model only via 9router**.

This repo is a **thin wrapper, not a new bridge**. It does not fork
[gemini-stealth-bridge](https://github.com/azrinaldi/gemini-stealth-bridge)
(`gsb`, Go, single static binary), does not rewrite it, and adds **no new
server or proxy**. It downloads the pinned `gsb` binary (SHA256-verified),
logs your accounts in, starts it, and shows you how to register it in
9router and pick its model in Lumitome. Unofficial wrapper — `gsb` itself
is an unofficial bridge to Gemini Web, not Google's supported API.

```
gsb (127.0.0.1:20133) → 9router (127.0.0.1:20128) → Lumitome
```

## Use it in 3 steps

**Linux** (MX Linux, etc.):
```sh
git clone https://github.com/fahmi0812/gemini-lumitome.git
cd gemini-lumitome
./install.sh        # Node >= 22, downloads gsb v0.4.0, verifies SHA256, links `gl`
gl login acc1       # temporary browser window — sign in (repeat: gl login acc2, acc3, ...)
gl probe            # verify models + 5h/weekly quota
gl start            # daemon on http://127.0.0.1:20133
gl connect          # shows the 9router registration + the Lumitome model name
```

**Windows** (PowerShell, no WSL):
```powershell
git clone https://github.com/fahmi0812/gemini-lumitome.git
cd gemini-lumitome
.\install.ps1
gl login acc1
gl probe
gl start
gl connect
```

Then in 9router's Dashboard, add a custom OpenAI-compatible provider
(see `gl connect` output and [docs/9ROUTER.md](docs/9ROUTER.md)):

| Setting | Value |
|---|---|
| Name | Gemini Stealth Bridge |
| Base URL | `http://127.0.0.1:20133/v1` |
| API type | Chat Completions (`chat`) or Responses (`responses`) |
| Prefix | `gsb` |
| Credential | pool key (`BRIDGE_API_KEY`) — **one connection only** |

Then in Lumitome, pick the model `gsb/<id-from-probe>` (e.g. the coding
model — see below). Lumitome's config is unchanged: it still talks only to
9router.

## Commands

```
gl setup            install gsb binary (SHA256-verified) + config
gl login <name>     sign in a Google account (acc1, acc2, ...) via temp browser
gl probe            verify accounts, models, 5h/weekly quota
gl start | stop | status
gl models [--refresh]  list models from gsb (cached 1h) + coding pick
gl bench [--live]   measure health/models/chat timings (live = real TTFT, needs account)
gl connect          show 9router registration + Lumitome model name
gl version | gl help
```

Env: `BRIDGE_API_KEY` (pool key; default `public` — change it, loopback
only), `GL_GSB_BIN` (override the gsb binary path). No secret is ever
written to a file by this CLI; accounts live in `gsb`'s own home
(`~/.gemini-lumitome/gsb-home/accounts/` — never commit that folder).

## Which model?

`gl models` lists the models your accounts can actually serve and picks
the coding one for you. On Gemini Web (verified 2026-11-13, account Pro):

| Web picker | Use for |
|---|---|
| 3.5 Flash-Lite — jawaban instan | fastest, lightest |
| 4 Hydrogen — bantuan sehari-hari (default) | everyday |
| 3.1 Pro — riset mendetail | research |
| **4 Argon — kode & analisis** | **coding (default pick)** |
| 4 Carbon — tugas paling kompleks | top tier (lock icon on some accounts) |

Model names drift upstream (Argon was renamed Carbon on 2026-11-10), so
always use the exact id from `gl probe` / `gl models`, never a web display
name. Thinking defaults to `low` (fast); use `high` for hard tasks.

## Latency — measured, not claimed

Measured in the build sandbox, 2026-11-13, 10 runs each (see
[DESIGN.md](DESIGN.md)):

| Path | p50 |
|---|---|
| gsb `/health` direct | 1.40 ms |
| gsb `/health` via one extra localhost proxy hop | 2.77 ms |
| gsb `/v1/models` (error path, no account) direct | 0.91 ms |
| gsb `/v1/models` via one extra localhost hop | 1.92 ms |

One extra localhost hop costs **≈ +1–1.4 ms (p50)** — negligible next to
Gemini generation (seconds) and next to the prompt-contract tool-calling
overhead. So the 9router hop is not a real latency cost, and direct mode
is not "much faster". **Live time-to-first-token is UNVERIFIED** — it needs
a logged-in account and cannot be measured in the build VM (see below).

## What is tested / not tested — honest

- ✅ Tested in the build VM (Linux, 2026-11-13): install from a clean
  clone, `gl` commands without an account (clear errors, no crashes),
  daemon start/stop, `/health`, `/v1/models`, `/v1/chat/completions`,
  `/v1/responses` error paths, auth 401/503 behaviour, `gl bench`
  (non-live), full test suite (see `tests/`).
- ⚠️ **Windows is UNVERIFIED in this release.** `install.ps1` and the
  `gsb_windows_amd64.exe` path are written from the upstream docs and the
  Linux-tested code, but were not run on Windows here. Please report the
  first Windows run.
- ⚠️ **Live generation is UNVERIFIED in this release.** The build VM has
  no Google account and its terminal cannot reach `gemini.google.com`.
  The live steps are in [docs/LIVE-TEST.md](docs/LIVE-TEST.md) — run them
  on a laptop with a logged-in account and report the tool-calling rate.

## Troubleshooting

- `no accounts configured` (503) → run `gl login acc1` then `gl probe`.
- `invalid api key` (401) → the key in `BRIDGE_API_KEY` does not match the
  daemon's key; restart with the same key: `gl stop && gl start`.
- `gl start` says already running → `gl status`, then `gl stop` if stale.
- Model id returns 404 → the name was renamed upstream; run
  `gl models --refresh` and use the id it prints.
- `tool_call_error` in Lumitome → `gsb` tool-calling is prompt-contract,
  not native. Re-run the task; if it keeps failing, that is the known
  weakest point of every Gemini Web bridge — see DESIGN.md.

## Why not direct, why not fork 9router, why not fork gsb?

Short version — [DESIGN.md](DESIGN.md) has the full argument with numbers:

- **Direct `gsb → Lumitome` saves ~1 ms** and breaks Lumitome's rule
  ("model only via 9router", "no proxy other than 9router") and loses
  9router fallback / multi-provider. Available as an explicit snippet in
  [docs/9ROUTER.md](docs/9ROUTER.md), not the default.
- **Forking 9router is unnecessary**: it already accepts custom
  OpenAI-compatible endpoints (verified in its code).
- **Forking `gsb` is unnecessary**: upstream is active (v0.4.0, Nov 2026)
  and forking would mean maintaining Google's protocol drift alone.

## License

MIT. `gsb` is a separate project by azrinaldi (see its own license).
Lumitome and 9router are separate projects by their own authors.
