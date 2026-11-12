// gemini-lumitome tests — node:test, stdlib only, no Google account needed.
// Commands are tested against a mock gsb daemon (plain node http server),
// so every assertion has a tight, red-capable feedback loop.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "gl-test-"));
process.env.HOME = TMP;
process.env.BRIDGE_API_KEY = "test123";
const cli = await import("../cli.mjs");

const FIXTURE_MODELS = [
  { id: "gemini-flash", display_name: "Gemini Flash" },
  { id: "gemini-argon", display_name: "Gemini Argon" },
  { id: "gemini-carbon", display_name: "Gemini Carbon" },
];

function mockDaemon(opts = {}) {
  const server = http.createServer((req, res) => {
    const send = (code, obj) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    if (req.url === "/health") return send(200, { status: "ok", accounts: opts.models503 ? 0 : 1, models: opts.models503 ? 0 : 3, transport: "stealth-utls-h2" });
    if (req.headers.authorization !== "Bearer test123") return send(401, { error: { message: "invalid api key", type: "authentication_error" } });
    if (req.url === "/v1/models") {
      if (opts.models503) return send(503, { error: { message: "no accounts configured", type: "auth_unavailable" } });
      return send(200, { data: FIXTURE_MODELS, object: "list" });
    }
    if (req.url === "/v1/accounts") return send(200, { accounts: [{ id: "acc1" }] });
    if (req.url === "/v1/chat/completions") return send(503, { error: { code: "auth_unavailable", message: "no accounts configured", type: "upstream_error" } });
    if (req.url === "/v1/responses") return send(503, { error: { code: "auth_unavailable", message: "no accounts configured", type: "upstream_error" } });
    return send(404, { error: { message: "not found" } });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}
function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections?.();
    setTimeout(resolve, 500);
  });
}
async function gl(...args) {
  return run(process.execPath, [path.join(ROOT, "cli.mjs"), ...args], {
    cwd: ROOT,
    env: { ...process.env, HOME: TMP, BRIDGE_API_KEY: "test123" },
  });
}

test("version consistency: VERSION == package.json == cli VERSION == gl version", async () => {
  const versionFile = fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim();
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(versionFile, "0.1.0");
  assert.equal(pkg.version, "0.1.0");
  assert.equal(cli.VERSION, "0.1.0");
  const { stdout } = await gl("version");
  assert.match(stdout, /gemini-lumitome 0\.1\.0/);
  assert.equal(pkg.dependencies, undefined, "zero npm dependencies");
});

test("pickCodingModel: argon first, then carbon, pro, flash, first, empty", () => {
  assert.equal(cli.pickCodingModel(FIXTURE_MODELS).id, "gemini-argon");
  assert.equal(cli.pickCodingModel([{ id: "gemini-carbon" }, { id: "gemini-flash" }]).id, "gemini-carbon");
  assert.equal(cli.pickCodingModel([{ id: "gemini-3.1-pro" }, { id: "gemini-flash" }]).id, "gemini-3.1-pro");
  assert.equal(cli.pickCodingModel([{ id: "gemini-flash" }]).id, "gemini-flash");
  assert.equal(cli.pickCodingModel([{ id: "something-else" }]).id, "something-else");
  assert.equal(cli.pickCodingModel([]).id, "");
});

test("stats/median math", () => {
  assert.equal(cli.median([3, 1, 2]), 2);
  assert.equal(cli.median([4, 1, 3, 2]), 2.5);
  assert.deepEqual(cli.stats([1, 2, 3, 4, 5]), { n: 5, min: 1, p50: 3, max: 5 });
});

test("gsbAssetName per OS/arch", () => {
  assert.equal(cli.gsbAssetName("linux", "x64"), "gsb_linux_amd64");
  assert.equal(cli.gsbAssetName("linux", "arm64"), "gsb_linux_arm64");
  assert.equal(cli.gsbAssetName("win32", "x64"), "gsb_windows_amd64.exe");
  assert.equal(cli.gsbAssetName("darwin", "arm64"), "gsb_darwin_arm64");
});

test("sha256 known vector", () => {
  assert.equal(cli.sha256(Buffer.from("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("config: defaults, save never stores secrets", () => {
  const cfg = cli.saveConfig({ ...cli.defaultConfig(), apiKey: "SHOULD-NOT-BE-SAVED" });
  assert.equal(cfg.apiKey, undefined);
  const onDisk = fs.readFileSync(cli.configPath(), "utf8");
  assert.ok(!onDisk.includes("SHOULD-NOT-BE-SAVED"));
  assert.equal(cli.loadConfig().port, 20133);
});

test("mock daemon: models fetch + 1h cache, status, bench (non-live), connect", async () => {
  const server = await mockDaemon();
  const port = server.address().port;
  cli.saveConfig({ ...cli.defaultConfig(), host: "127.0.0.1", port });
  try {
    const models = await cli.fetchModels(cli.loadConfig(), { refresh: true });
    assert.deepEqual(models.map((m) => m.id), ["gemini-flash", "gemini-argon", "gemini-carbon"]);
  } finally {
    await closeServer(server);
  }
  // cache still serves after the daemon is gone
  const cached = await cli.fetchModels(cli.loadConfig());
  assert.equal(cached.length, 3);

  const server2 = await mockDaemon();
  const port2 = server2.address().port;
  cli.saveConfig({ ...cli.defaultConfig(), host: "127.0.0.1", port: port2 });
  try {
    const st = await gl("status");
    assert.match(st.stdout, /status: OK — accounts=1 models=3/);
    const mo = await gl("models");
    assert.match(mo.stdout, /gemini-argon/);
    assert.match(mo.stdout, /coding model: gemini-argon/);
    const be = await gl("bench");
    assert.match(be.stdout, /health:/);
    assert.match(be.stdout, /models-cached:/);
    assert.match(be.stdout, /live TTFT UNVERIFIED/);
    const co = await gl("connect");
    assert.match(co.stdout, /Gemini Stealth Bridge/);
    assert.match(co.stdout, /Base URL:\s+http:\/\/127\.0\.0\.1:\d+\/v1/);
    assert.match(co.stdout, /gsb\/gemini-argon/);
    assert.match(co.stdout, /Direct mode|direct mode/);
  } finally {
    await closeServer(server2);
  }
});

test("mock daemon: wrong key -> 401, handled as an error not a crash", async () => {
  const server = await mockDaemon();
  const port = server.address().port;
  cli.saveConfig({ ...cli.defaultConfig(), host: "127.0.0.1", port });
  const prevKey = process.env.BRIDGE_API_KEY;
  process.env.BRIDGE_API_KEY = "wrong-key";
  try {
    await assert.rejects(
      () => cli.fetchModels(cli.loadConfig(), { refresh: true }),
      /HTTP 401/,
    );
  } finally {
    process.env.BRIDGE_API_KEY = prevKey;
    await closeServer(server);
  }
});

test("commands without a daemon fail with a clear message, not a crash", async () => {
  cli.saveConfig({ ...cli.defaultConfig(), host: "127.0.0.1", port: 59999 });
  const st = await gl("status");
  assert.match(st.stdout, /not running/);
  let err;
  try { await gl("models", "--refresh"); } catch (e) { err = e; }
  assert.ok(err, "gl models --refresh should exit non-zero without a daemon");
  assert.match(String(err.stderr || "") + String(err.stdout || ""), /fetch failed|ECONNREFUSED/);
  let benchErr;
  try { await gl("bench"); } catch (e) { benchErr = e; }
  assert.ok(benchErr, "gl bench should exit non-zero without a daemon");
  assert.match(String(benchErr.stderr || ""), /gsb is not running/);
});

test("bench without an account reports timings as unavailable instead of dying mid-run", async () => {
  const server = await mockDaemon({ models503: true });
  const port = server.address().port;
  cli.saveConfig({ ...cli.defaultConfig(), host: "127.0.0.1", port });
  try {
    const be = await gl("bench");
    assert.match(be.stdout, /health:/);
    assert.match(be.stdout, /models: unavailable \(GET \/v1\/models -> HTTP 503/);
    assert.match(be.stdout, /chat: HTTP 503/);
    assert.match(be.stdout, /live TTFT UNVERIFIED/);
  } finally {
    await closeServer(server);
  }
});

test("install scripts: verify SHA256, contain no secrets", () => {
  for (const f of ["install.sh", "install.ps1"]) {
    const s = fs.readFileSync(path.join(ROOT, f), "utf8");
    assert.ok(/SHA256|Get-FileHash/i.test(s), `${f} must verify the binary hash`);
    assert.ok(!/__Secure-|g\.a0|sk-|ghp_|BRIDGE_API_KEY=\w/.test(s), `${f} must not contain a literal secret`);
  }
});

test("README documents what is tested and what is UNVERIFIED", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  for (const needle of ["3 steps", "UNVERIFIED", "Windows", "Latency", "4 Argon", "9router"]) {
    assert.ok(readme.includes(needle), `README must mention: ${needle}`);
  }
  assert.ok(!readme.includes("274amanah"), "README must not hardcode the user's account");
});
