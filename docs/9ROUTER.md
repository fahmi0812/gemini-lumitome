# Register gsb in 9router + pick the model in Lumitome

## 1. Start gsb first (on the same machine as 9router)

```sh
gl login acc1     # repeat for acc2, acc3, ... — one login per Google account
gl probe          # note the exact model ids it prints
gl start          # daemon on http://127.0.0.1:20133
```

## 2. Register in 9router (Dashboard)

Dashboard → Providers → add a custom OpenAI-compatible provider:

| Setting | Value |
|---|---|
| Name | Gemini Stealth Bridge |
| Base URL | `http://127.0.0.1:20133/v1` |
| API type | Chat Completions (`chat`) or Responses (`responses`) |
| Prefix | `gsb` |
| Credential | pool key (`BRIDGE_API_KEY`) |

**Use ONE connection with the pool key.** Account rotation, quota, and
conversation-continuation affinity live inside `gsb`. If 9router spreads
requests across per-account connections, it only learns about exhaustion
from a 429 and will move the next turn to a different account, discarding
the cached Gemini session. Per-account keys (`gsb-acc1`) are only for
deliberately pinning traffic to one account.

If 9router runs in a container, `127.0.0.1` means that container, not the
host running `gsb` — use the host address instead (and read `gsb`'s
Security section first; loopback-only is the safe default).

Check it worked: `gl connect` prints the values above and the Lumitome
model name. If 9router's `/health` is unreachable from the machine you
run `gl` on, check on the machine where 9router actually runs.

## 3. Pick the model in Lumitome

Lumitome's config does not change — it still talks only to 9router.
Pick the model at run time (or in your Lumitome model selection):

```
gsb/<id-from-probe>
```

Example (verify the id with `gl models` first — names drift upstream):

```
gsb/gemini-flash
```

Coding default: the model whose id contains `argon` (Gemini Web
"Kode & analisis"). `gl models` picks it for you and explains why.

## Direct mode (optional, NOT the default)

Point OpenCode/Lumitome directly at `gsb` instead of through 9router:

- Base URL: `http://127.0.0.1:20133/v1`
- API key: pool key (`BRIDGE_API_KEY`)
- Model: the id from `gl models`

Tradeoff, measured: it saves ≈ 1 ms per request (one localhost hop)
and **breaks Lumitome's rule** ("model only via 9router", "no proxy
other than 9router") and loses 9router fallback and multi-provider
routing. Use it only as a deliberate, user-level choice — never as a
change committed to the Lumitome repo.
