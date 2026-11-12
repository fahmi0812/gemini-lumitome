# DESIGN.md — gemini-lumitome v0.1.0

## The problem, in one sentence

Use Gemini Web accounts (Pro, multi-account) inside Lumitome/OpenCode with
the fewest moving parts, the lowest added latency, and the easiest install
on Linux and Windows — without touching Lumitome's repo or its rules.

## Skills applied (read live, 2026-11-13)

- **mattpocock `diagnosing-bugs`**: build a tight feedback loop first
  (failing test / curl script / CLI invocation against a fixture), then
  reproduce, minimise, hypothesise. Applied here: the test suite runs
  `gl` against a mock `gsb` daemon (node http server) so every command
  has a red-capable loop without a Google account.
- **mattpocock `improve-codebase-architecture`**: deep modules, deletion
  test. Applied: one CLI file (`cli.mjs`) is the whole product — any extra
  module would just move complexity. The interface (the `gl` commands) is
  the test surface.
- **superpowers `systematic-debugging`**: no fix without root cause;
  ≥3 failed fixes → question the architecture. Applied to the latency
  question below: instead of a third optimisation, we questioned the
  premise that the 9router hop matters.
- **superpowers `verification-before-completion`**: no completion claim
  without fresh verification. Applied: every claim in README is backed by
  a test run in this release (see "Verification" below); Windows and live
  generation are labelled UNVERIFIED, not claimed.
- **pstack `attack-the-premise` / `explain-the-number` / `fix-root-causes`**:
  see the two premises below. Numbers carry run count, spread, and limiter.
- **Lumitome `rea-analysis-optimization`**: find the earliest unnecessary
  work and remove it at its owner; do not add a cache/index/layer without
  naming the work it removes. Applied: no new proxy/server layer; the only
  cache is `GET /v1/models` (1h, in `~/.gemini-lumitome/models.json`) —
  the work it removes is one upstream registry call per command invocation.
  Preseden Lumitome v0.3.33: `route()` 62,2 ms → 8–12 ms by removing
  repeated trigram/vocab work at its owner, not by adding a layer.
- **`latency-optimization` (Lumitome)**: this skill name does **not** exist
  (verified 2026-11-12). Not cited as a source anywhere in this repo.

## Premise 1 — "Direct gsb → Lumitome is much faster than via 9router"

**Tested, not assumed.** Decision that would change if false: default path.

Measured 2026-11-13 in the build sandbox, 10 runs each, `gsb` daemon
running locally, no account (error paths — the hop cost is in the local
transport, not in upstream generation):

| Path | min | p50 | max |
|---|---|---|---|
| `/health` direct to gsb | 0.79 ms | 1.40 ms | 19.08 ms |
| `/health` via one extra localhost proxy hop | 1.86 ms | 2.77 ms | 34.03 ms |
| `/v1/models` direct (503, no account) | 0.57 ms | 0.91 ms | 4.52 ms |
| `/v1/models` via one extra localhost hop | 1.46 ms | 1.92 ms | 3.91 ms |

Extra localhost hop: **≈ +1.0–1.4 ms (p50)**. Limiter: localhost TCP +
one JSON forward, not the network. Why not double? Because the hop is
already ~1 ms — there is nothing left to halve; the dominant cost is
upstream Gemini generation (seconds) plus `gsb`'s prompt-contract
tool-calling. What the number could also be measuring: first-run JIT /
cold start (the max values show it); the p50 is the stable figure.

**Verdict: premise FALSE as a reason to go direct.** Saving ~1 ms does
not justify breaking Lumitome's rule or losing 9router fallback and
multi-provider routing. Default = via 9router. Direct mode is documented
as an explicit opt-in only.

## Premise 2 — "Lumitome needs a `lumitome connect` command / a config change"

**Tested against the code.** Lumitome v0.3.37 `lumitome/bin/cli.mjs` is a
wrapper that spawns the OpenCode engine; there is no `connect` subcommand.
Its `opencode.jsonc` already has exactly one provider: `9router`
(`aisdk:@ai-sdk/openai-compatible`, baseURL `{env:SW_9ROUTER_URL}`,
model `9router/ag/gemini-3.8-flash-high`). Its `AGENTS.md` says:
"Model hanya via 9router" and "Jangan LiteLLM / proxy selain 9router".

**Verdict: premise FALSE.** Nothing in Lumitome needs to change. The
connection point is 9router's Dashboard (custom OpenAI-compatible
provider), and Lumitome only needs a model name change
(`gsb/<id-from-probe>`) at run time. This repo therefore contains zero
Lumitome code and zero Lumitome config.

## Premise 3 — "We should fork gsb / 9router to add this"

**Tested:** `gsb` v0.4.0 is active (Nov 2026) and documents the 9router
path in its README §7.2; 9router accepts custom OpenAI-compatible
endpoints in its code (`OPENAI_COMPATIBLE_PREFIX = "openai-compatible-"`,
`providerSpecificData.baseUrl`). Forking either would mean maintaining
Google's web-protocol drift (gsb) or a whole router (9router) alone, for
no feature that is missing.

**Verdict: no fork.** Thin wrapper only.

## Architecture (the whole thing)

```
User's Google accounts (acc1, acc2, … — interactive login, cookies in gsb-home)
        │  gsb --login / --probe
        ▼
gsb daemon (Go static binary, 127.0.0.1:20133, browserless uTLS+HTTP/2)
        │  OpenAI-compatible /v1/chat/completions + /v1/responses
        ▼  (one localhost hop, ≈ +1 ms)
9router (127.0.0.1:20128, custom provider "Gemini Stealth Bridge", prefix gsb)
        │  model gsb/<id>
        ▼
Lumitome / OpenCode (unchanged; provider 9router)
```

Components in this repo (and nothing else):

| File | What it is | Why it exists |
|---|---|---|
| `cli.mjs` | Node stdlib-only CLI (`gl`) | setup/login/probe/start/stop/status/models/bench/connect; the test surface |
| `install.sh` / `install.ps1` | one-command install, Linux / Windows | same commands on both OSes; no WSL, Docker, Python |
| `VERSION`, `package.json` | version single-source (0.1.0) | release gate: VERSION == tag |
| `tests/test.mjs` | node:test, stdlib only, mock gsb daemon | tight feedback loop without a Google account |
| `docs/9ROUTER.md`, `docs/LIVE-TEST.md` | click-by-click + live test script | the parts that cannot be automated honestly |

Latency rules baked into the CLI:

- No Docker, no Cloudflare, no Python, no headless browser at run time.
- Localhost only; HTTP keep-alive via `fetch`.
- `GET /v1/models` cached 1h (one file, explicit TTL, `--refresh` to bypass).
- Coding model pinned from the live list (Argon first), thinking `low`
  by default; `high` is opt-in per task.
- Session/continuation reuse is `gsb`'s job (pool key, one connection) —
  this CLI never splits a pool into per-account connections.

## Known weak point (honest)

Every Gemini Web bridge, including `gsb`, does tool-calling as a
**prompt-contract** (tools described in the prompt, model asked to emit a
tool-call block), not native function calling. That is the single most
fragile point for a coding agent. No wrapper can fix it; the live test in
`docs/LIVE-TEST.md` measures the valid-tool-call rate first, before any
further feature is added (superpowers: fix the root cause, don't guard
the symptom).

## Verification (this release)

- `node --test tests/test.mjs` — full suite, run fresh before tagging
  (counts in the release report; must be 0 failures).
- Clean-clone install: `./install.sh` in a fresh sandbox copy, then
  `gl --help`, `gl version`, `gl status` (no account → clear message),
  `gl bench` (non-live timings), daemon start/stop.
- `gsb` daemon endpoints re-verified 2026-11-13 (see README): /health 200,
  auth 401/503 as expected, /v1/models+chat+responses 503 without account.
- Secret scan before push: grep for keys/tokens/cookies/accounts in the
  diff — must be 0 hits. No account file, `.env`, or key is committed.
- **UNVERIFIED in this release:** Windows install/run; live generation
  and tool-calling rate on a logged-in account. Both are labelled as such
  in README and tracked in `docs/LIVE-TEST.md`.
