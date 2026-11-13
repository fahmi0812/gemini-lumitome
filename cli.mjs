// gemini-lumitome — thin wrapper around gemini-stealth-bridge (gsb).
// Node stdlib only. No server, no proxy, no extra hop: this CLI manages the
// gsb binary and tells you how to point 9router / Lumitome at it.
// Default path (respects Lumitome's rule "model only via 9router"):
//   gsb (127.0.0.1:20133) -> 9router (127.0.0.1:20128) -> Lumitome
// Direct mode (gsb -> OpenCode/Lumitome) is an explicit opt-in snippet only,
// documented in docs/9ROUTER.md with its tradeoff.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { pathToFileURL } from "node:url";

export const VERSION = "0.1.1";
export const GSB_VERSION = "0.4.0"; // pinned upstream release, verified 2026-11-13
export const GSB_PORT = 20133;
export const NINEROUTER_URL = "http://127.0.0.1:20128/v1";
export const GSB_RELEASE_BASE = `https://github.com/azrinaldi/gemini-stealth-bridge/releases/download/v${GSB_VERSION}`;

export function homeDir() {
  return path.join(os.homedir(), ".gemini-lumitome");
}
export function configPath() {
  return path.join(homeDir(), "config.json");
}
export function gsbHome() {
  return path.join(homeDir(), "gsb-home");
}
export function binDir() {
  return path.join(homeDir(), "bin");
}
export function gsbBin() {
  if (process.env.GL_GSB_BIN) return process.env.GL_GSB_BIN;
  return path.join(binDir(), process.platform === "win32" ? "gsb.exe" : "gsb");
}
export function pidPath() {
  return path.join(homeDir(), "gsb.pid");
}
export function logPath() {
  return path.join(homeDir(), "gsb.log");
}
export function modelsCachePath() {
  return path.join(homeDir(), "models.json");
}

export function defaultConfig() {
  return {
    gsbVersion: GSB_VERSION,
    host: "127.0.0.1",
    port: GSB_PORT,
    model: "", // empty = auto-pick from GET /v1/models (coding model first)
    think: "low", // fast default; "high" for hard tasks
    apiKeyEnv: "BRIDGE_API_KEY",
  };
}
export function loadConfig() {
  try {
    return { ...defaultConfig(), ...JSON.parse(fs.readFileSync(configPath(), "utf8")) };
  } catch {
    return defaultConfig();
  }
}
export function saveConfig(cfg) {
  fs.mkdirSync(homeDir(), { recursive: true });
  // Never store secrets here: api keys stay in env only.
  const { apiKey, ...safe } = cfg;
  fs.writeFileSync(configPath(), JSON.stringify(safe, null, 2) + "\n");
  return safe;
}
export function apiKey() {
  const k = process.env.BRIDGE_API_KEY || process.env.GL_API_KEY || "public";
  if (k === "public") {
    console.error("warning: using default API key 'public' — set BRIDGE_API_KEY to a secret value, loopback only.");
  }
  return k;
}
export function baseUrl(cfg = loadConfig()) {
  return `http://${cfg.host}:${cfg.port}/v1`;
}
export function gsbAssetName(platform = process.platform, arch = process.arch) {
  const osName = platform === "win32" ? "windows" : platform === "darwin" ? "darwin" : "linux";
  const cpu = arch === "arm64" ? "arm64" : "amd64";
  return `gsb_${osName}_${cpu}${platform === "win32" ? ".exe" : ""}`;
}
export function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}
export async function fetchWithTimeout(url, opts = {}, ms = 10000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: c.signal });
  } finally {
    clearTimeout(t);
  }
}
export function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}
export function stats(ts) {
  const s = [...ts].sort((a, b) => a - b);
  return { n: ts.length, min: +s[0].toFixed(2), p50: +median(ts).toFixed(2), max: +s[s.length - 1].toFixed(2) };
}

// Pick the coding model from a /v1/models list, by id — never by web display
// name (web names drift: Argon was renamed Carbon upstream on 2026-11-10).
// Hydrogen only, no fallback to other tiers: measured 2026-11-13 on a 6-token
// prompt, hydrogen p50 TTFT 12.2 s while gemini-pro and gemini-carbon gave no
// first token within 45 s. Silently falling back to them would reintroduce
// the hang, so a missing hydrogen is reported instead.
export function pickCodingModel(models) {
  const list = (models || []).map((m) => (typeof m === "string" ? { id: m } : m));
  const hit = list.find((m) => /hydrogen/i.test(m.id || ""));
  if (!hit) return { id: "", reason: "no hydrogen model returned (run: gl models --refresh)" };
  return { id: hit.id, reason: "hydrogen only (pro/carbon: no first token within 45 s, 2026-11-13)" };
}
export async function fetchModels(cfg = loadConfig(), { refresh = false } = {}) {
  const cache = modelsCachePath();
  if (!refresh) {
    try {
      const c = JSON.parse(fs.readFileSync(cache, "utf8"));
      if (Date.now() - c.fetchedAt < 3600_000 && Array.isArray(c.models)) return c.models;
    } catch { /* cache miss */ }
  }
  const r = await fetchWithTimeout(`${baseUrl(cfg)}/models`, {
    headers: { Authorization: `Bearer ${apiKey()}` },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`GET /v1/models -> HTTP ${r.status} ${body.slice(0, 200)}`);
  }
  const data = await r.json();
  const models = data.data || [];
  fs.mkdirSync(homeDir(), { recursive: true });
  fs.writeFileSync(cache, JSON.stringify({ fetchedAt: Date.now(), models }, null, 2));
  return models;
}
export async function health(cfg = loadConfig()) {
  const r = await fetchWithTimeout(`http://${cfg.host}:${cfg.port}/health`, {}, 5000);
  return r.ok ? await r.json() : null;
}
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit", ...opts });
    p.on("error", reject);
    p.on("exit", (code) => (code === 0 ? resolve(0) : reject(new Error(`${cmd} exited ${code}`))));
  });
}
function runCapture(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { ...opts }, (err, stdout, stderr) => {
      if (err && !stdout) return reject(err);
      resolve({ stdout, stderr, code: err ? err.code : 0 });
    });
  });
}

async function cmdSetup() {
  const cfg = loadConfig();
  if (process.version < "v22") throw new Error(`Node >= 22 required, found ${process.version}`);
  const asset = gsbAssetName();
  console.log(`setup: downloading gsb v${GSB_VERSION} (${asset}) …`);
  const sumsRes = await fetchWithTimeout(`${GSB_RELEASE_BASE}/SHA256SUMS`, {}, 30000);
  if (!sumsRes.ok) throw new Error(`SHA256SUMS download failed: HTTP ${sumsRes.status}`);
  const sums = await sumsRes.text();
  const want = sums.split("\n").find((l) => l.trim().endsWith(asset));
  if (!want) throw new Error(`no SHA256 entry for ${asset} in upstream SHA256SUMS`);
  const wantHash = want.split(/\s+/)[0];
  const binRes = await fetchWithTimeout(`${GSB_RELEASE_BASE}/${asset}`, {}, 120000);
  if (!binRes.ok) throw new Error(`gsb download failed: HTTP ${binRes.status}`);
  const buf = Buffer.from(await binRes.arrayBuffer());
  const got = sha256(buf);
  if (got !== wantHash) throw new Error(`SHA256 mismatch for ${asset}: got ${got}, want ${wantHash}`);
  fs.mkdirSync(binDir(), { recursive: true });
  fs.writeFileSync(gsbBin(), buf);
  if (process.platform !== "win32") fs.chmodSync(gsbBin(), 0o755);
  saveConfig(cfg);
  const v = await runCapture(gsbBin(), ["--version"]);
  console.log(`setup: OK — ${v.stdout.trim()} (SHA256 verified)`);
  console.log(`setup: binary at ${gsbBin()}`);
  console.log("next: gl login acc1   (repeat acc2, acc3 … for your other accounts)");
  console.log("then: gl probe && gl start");
}
async function cmdLogin(name) {
  if (!name) throw new Error("usage: gl login <name>  (e.g. gl login acc1)");
  if (!fs.existsSync(gsbBin())) throw new Error("gsb not installed — run: gl setup");
  console.log(`login ${name}: a temporary browser window will open — sign in with that Google account.`);
  await run(gsbBin(), ["--login", name], { env: { ...process.env, BRIDGE_HOME: gsbHome() } });
}
async function cmdProbe() {
  if (!fs.existsSync(gsbBin())) throw new Error("gsb not installed — run: gl setup");
  await run(gsbBin(), ["--probe"], { env: { ...process.env, BRIDGE_HOME: gsbHome() } });
}
async function cmdStart() {
  const cfg = loadConfig();
  if (!fs.existsSync(gsbBin())) throw new Error("gsb not installed — run: gl setup");
  try {
    const h = await health(cfg);
    if (h) { console.log(`start: already running (accounts=${h.accounts}, models=${h.models})`); return; }
  } catch { /* not running */ }
  fs.mkdirSync(homeDir(), { recursive: true });
  const log = fs.openSync(logPath(), "a");
  const child = spawn(gsbBin(), ["--web"], {
    detached: true,
    stdio: ["ignore", log, log],
    env: { ...process.env, BRIDGE_HOME: gsbHome(), BRIDGE_API_KEY: apiKey() },
  });
  child.unref();
  fs.writeFileSync(pidPath(), String(child.pid));
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const h = await health(cfg);
      if (h) {
        console.log(`start: OK — http://${cfg.host}:${cfg.port} (accounts=${h.accounts}, models=${h.models})`);
        console.log(`start: dashboard http://${cfg.host}:${cfg.port}/ui  log ${logPath()}`);
        return;
      }
    } catch { /* keep waiting */ }
  }
  throw new Error(`gsb did not become healthy in 15s — see ${logPath()}`);
}
async function cmdStop() {
  try {
    const pid = Number(fs.readFileSync(pidPath(), "utf8").trim());
    process.kill(pid, "SIGTERM");
    fs.unlinkSync(pidPath());
    console.log(`stop: OK (pid ${pid})`);
  } catch {
    console.log("stop: no pid file — gsb may not have been started by gl (check manually).");
  }
}
async function cmdStatus() {
  const cfg = loadConfig();
  try {
    const h = await health(cfg);
    if (!h) { console.log("status: daemon not responding on /health"); return; }
    console.log(`status: OK — accounts=${h.accounts} models=${h.models} transport=${h.transport}`);
    try {
      const r = await fetchWithTimeout(`${baseUrl(cfg)}/accounts`, { headers: { Authorization: `Bearer ${apiKey()}` } });
      const d = await r.json();
      console.log(`status: /v1/accounts -> HTTP ${r.status}, ${(d.accounts || []).length} account(s)`);
    } catch (e) { console.log(`status: /v1/accounts unreachable: ${e.message}`); }
  } catch (e) {
    console.log(`status: gsb not running (${e.message}) — run: gl start`);
  }
}
async function cmdModels(refresh) {
  const models = await fetchModels(loadConfig(), { refresh });
  for (const m of models) console.log(`${m.id}\t${m.display_name || ""}`);
  const pick = pickCodingModel(models);
  console.log(`coding model: ${pick.id || "(none)"} — ${pick.reason}`);
}
async function timeit(fn, n = 5) {
  const ts = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    await fn();
    ts.push(performance.now() - t0);
  }
  return stats(ts);
}
async function cmdBench(live, { model = "", timeoutS = 60 } = {}) {
  const cfg = loadConfig();
  try {
    const h = await health(cfg);
    if (!h) throw new Error("daemon not responding on /health");
  } catch (e) {
    throw new Error(`bench: gsb is not running (${e.message}) — run: gl start`);
  }
  console.log("  health:", JSON.stringify(await timeit(() => health(cfg))));
  console.log("bench: /v1/models uncached (5x)…");
  try {
    console.log("  models:", JSON.stringify(await timeit(() => fetchModels(cfg, { refresh: true }))));
  } catch (e) {
    console.log(`  models: unavailable (${e.message}) — expected without a logged-in account`);
  }
  console.log("bench: /v1/models cached (5x)…");
  try {
    console.log("  models-cached:", JSON.stringify(await timeit(() => fetchModels(cfg))));
  } catch (e) {
    console.log(`  models-cached: unavailable (${e.message}) — expected without a logged-in account`);
  }
  console.log("bench: /v1/chat/completions error path (1x, no account expected)…");
  const t0 = performance.now();
  const r = await fetchWithTimeout(`${baseUrl(cfg)}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gemini-flash", messages: [{ role: "user", content: "Reply with OK." }] }),
  }).catch((e) => ({ status: 0, error: e.message }));
  console.log(`  chat: HTTP ${r.status ?? "?"} in ${(performance.now() - t0).toFixed(1)} ms`);
  if (!live) {
    console.log("bench: live TTFT UNVERIFIED (no account in this run) — run: gl bench --live on a machine with a logged-in account.");
    return;
  }
  const id = model || pickCodingModel(await fetchModels(cfg)).id;
  if (!id) throw new Error("bench --live: no models available");
  console.log(`bench: live chat with ${id} (time to first token, timeout ${timeoutS} s)…`);
  // Abort covers both the response headers and the first chunk: gsb sends
  // headers only when the upstream's first byte arrives, so a stuck model
  // (seen: gemini-pro/carbon >45 s on a 6-token prompt) would hang forever.
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), timeoutS * 1000);
  const t1 = performance.now();
  try {
    const res = await fetch(`${baseUrl(cfg)}/chat/completions`, {
      method: "POST",
      signal: c.signal,
      headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: id, messages: [{ role: "user", content: "Reply with exactly OK." }], stream: true }),
    });
    const reader = res.body.getReader();
    const first = await reader.read();
    console.log(`  live TTFT: ${(performance.now() - t1).toFixed(0)} ms, HTTP ${res.status}, first chunk ${first.value?.length ?? 0} bytes`);
    await reader.cancel().catch(() => {});
  } catch (e) {
    if (c.signal.aborted) throw new Error(`bench --live: ${id} sent no first token within ${timeoutS} s — retry with a longer --timeout, or check quota: gl probe`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
async function cmdConnect() {
  const cfg = loadConfig();
  let model = cfg.model;
  try {
    const models = await fetchModels(cfg);
    model = model || pickCodingModel(models).id;
  } catch (e) {
    console.log(`connect: cannot list models from gsb (${e.message}) — run: gl login acc1 && gl probe && gl start`);
  }
  console.log("connect: register gsb in 9router (Dashboard -> Providers -> custom OpenAI-compatible):");
  console.log(`  Name:      Gemini Stealth Bridge`);
  console.log(`  Base URL:  http://127.0.0.1:${cfg.port}/v1`);
  console.log(`  API type:  Chat Completions (chat) or Responses (responses)`);
  console.log(`  Prefix:    gsb`);
  console.log(`  Credential: pool key (BRIDGE_API_KEY) — ONE connection only, so gsb keeps rotation + session affinity`);
  console.log(`connect: then in Lumitome (unchanged config, still via 9router) pick model: gsb/${model || "<id-from-probe>"}`);
  console.log(`  9router itself: ${NINEROUTER_URL} (check it answers; if not running, start 9router first)`);
  try {
    const r = await fetchWithTimeout(NINEROUTER_URL.replace("/v1", "/health"), {}, 3000);
    console.log(`  9router /health: HTTP ${r.status}`);
  } catch {
    console.log("  9router /health: unreachable from here (expected if 9router runs on another machine — check on the laptop).");
  }
  console.log("connect: direct mode (optional, NOT the default): point OpenCode at");
  console.log(`  http://127.0.0.1:${cfg.port}/v1 with the pool key and model ${model || "gemini-flash"}.`);
  console.log("  Tradeoff: saves ~1 ms (one localhost hop) but breaks Lumitome's rule");
  console.log("  'model only via 9router' and loses 9router fallback/multi-provider.");
}
const HELP = `gemini-lumitome ${VERSION} — Gemini Web -> Lumitome, via gsb + 9router (default)
  gl setup            install gsb binary (SHA256-verified) + config
  gl login <name>     sign in a Google account (acc1, acc2, ...) via temp browser
  gl probe            verify accounts, models, 5h/weekly quota
  gl start | stop | status
  gl models [--refresh]  list models from gsb (cached 1h) + coding pick
  gl bench [--live] [--model <id>] [--timeout <s>]
                      measure health/models/chat timings (live = real TTFT, needs account;
                      default model = coding pick, default timeout 60 s)
  gl connect          show 9router registration + Lumitome model name
  gl version | gl help
Env: BRIDGE_API_KEY (pool key; default 'public' — change it), GL_GSB_BIN (override binary path).
Docs: README.md, DESIGN.md, docs/LIVE-TEST.md, docs/9ROUTER.md`;
async function main(argv) {
  const [cmd, ...rest] = argv;
  try {
    switch (cmd) {
      case undefined:
      case "help": case "--help": case "-h": console.log(HELP); break;
      case "version": case "--version": case "-v": console.log(`gemini-lumitome ${VERSION} (gsb ${GSB_VERSION})`); break;
      case "setup": await cmdSetup(); break;
      case "login": await cmdLogin(rest[0]); break;
      case "probe": await cmdProbe(); break;
      case "start": await cmdStart(); break;
      case "stop": await cmdStop(); break;
      case "status": await cmdStatus(); break;
      case "models": await cmdModels(rest.includes("--refresh")); break;
      case "bench": {
        const opt = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
        const timeoutS = Number(opt("--timeout") ?? 60);
        if (!(timeoutS > 0)) throw new Error("bench: --timeout must be a positive number of seconds");
        await cmdBench(rest.includes("--live"), { model: opt("--model") || "", timeoutS });
        break;
      }
      case "connect": await cmdConnect(); break;
      default: console.error(`unknown command: ${cmd}\n${HELP}`); process.exitCode = 2;
    }
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exitCode = 1;
  }
}
// main() must run even when the repo lives in a path with spaces
// (e.g. "LAB GITHUB"): import.meta.url URL-encodes them (%20) while
// process.argv[1] does not, so a plain string comparison silently
// never matches and the CLI exits with no output. pathToFileURL
// encodes both sides the same way.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main(process.argv.slice(2));
