#!/bin/sh
# gemini-lumitome installer — Linux (and macOS). No Docker, no Python, no WSL.
# Usage (from a clone of this repo):
#   ./install.sh
# What it does: checks Node >= 22, runs `node cli.mjs setup` (downloads the
# pinned gsb binary and verifies its SHA256), then links `gl` into ~/.local/bin.
set -eu
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "error: Node.js >= 22 is required (Lumitome/OpenCode need it too). Install Node, then re-run ./install.sh" >&2
  exit 1
fi
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "error: Node >= 22 required, found $(node --version)" >&2
  exit 1
fi
node cli.mjs setup
mkdir -p "$HOME/.local/bin"
printf '#!/bin/sh\nexec node "%s/cli.mjs" "$@"\n' "$PWD" > "$HOME/.local/bin/gl"
chmod +x "$HOME/.local/bin/gl"
ln -sf "$HOME/.local/bin/gl" "$HOME/.local/bin/gemini-lumitome"
echo "installed: gl -> $HOME/.local/bin/gl"
echo "make sure ~/.local/bin is on your PATH, then run:"
echo "  gl login acc1   # sign in with a Google account (repeat acc2, acc3, ...)"
echo "  gl probe && gl start && gl connect"
