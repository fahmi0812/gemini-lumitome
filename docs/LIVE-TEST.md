# LIVE-TEST.md — live test on Fahmi's laptop (MX Linux)

This is the test that **cannot** run in the build VM (no Google account
there, and the VM terminal cannot reach `gemini.google.com`). Run it on
the laptop, record the numbers, and report them back — do not claim the
live path works until this is done.

## Preconditions

- `gl` installed (`./install.sh`), `gsb` v0.4.0 verified by SHA256.
- Chrome/Chromium available for `gl login`.
- 9router running on `http://127.0.0.1:20128/v1`.
- Lumitome installed (v0.3.37+).

## Steps

1. **Login + probe**
   ```sh
   gl login acc1
   gl probe
   ```
   Record: models listed (exact ids), 5h quota remaining, weekly quota
   remaining. Coding model should be the Argon-equivalent id.

2. **Daemon + bench (live)**
   ```sh
   gl start
   gl status
   gl bench --live
   ```
   Record: live TTFT (ms) from `gl bench --live`. Pass bar: TTFT
   reported at all (any number) — the point is a real upstream answer.

3. **9router registration** — follow [9ROUTER.md](9ROUTER.md), then:
   ```sh
   gl connect
   ```
   Record: the `gsb/<id>` model name 9router exposes.

4. **Lumitome small coding task** (the tool-calling test — the important one)
   In Lumitome, pick model `gsb/<id>`, then ask it to do a small real
   task in a scratch repo: read one file, make one small edit, run one
   test command. Count, over the whole task:
   - tool calls that were valid (executed as intended),
   - tool calls that failed / were repaired / were hallucinated.
   - Pass bar (decide before running): ≥ 95% valid over ≥ 20 calls.
     If it fails, record the failure mode (malformed envelope? wrong
     schema? truncated?) — that is the root cause to fix next, not a
     reason to add a retry wrapper.

5. **Failover (optional, if you have 2+ accounts)**
   Log in a second account (`gl login acc2`), exhaust or pause acc1 if
   practical, and confirm a request still succeeds via the pool key.

## Report back

Paste: probe output (redact account emails), `gl bench --live` output,
tool-call counts from step 4, and the Lumitome model name used.
