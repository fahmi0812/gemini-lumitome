# gemini-lumitome installer — Windows (PowerShell, no WSL, no Docker, no Python).
# Usage (from a clone of this repo, in PowerShell):
#   .\install.ps1
# What it does: checks Node >= 22, runs `node cli.mjs setup` (downloads the
# pinned gsb_windows_amd64.exe and verifies its SHA256), then creates
# gl.cmd / gemini-lumitome.cmd in $HOME\.gemini-lumitome\bin and adds that
# folder to the user PATH.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js >= 22 is required (Lumitome/OpenCode need it too). Install Node, then re-run .\install.ps1"
}
$major = [int]((node -p "process.versions.node.split('.')[0]"))
if ($major -lt 22) { throw "Node >= 22 required, found $(node --version)" }
node cli.mjs setup
$binDir = Join-Path $HOME ".gemini-lumitome\bin"
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
$cli = Join-Path $PSScriptRoot "cli.mjs"
@("gl.cmd", "gemini-lumitome.cmd") | ForEach-Object {
  $wrapper = Join-Path $binDir $_
  "@echo off`r`nnode `"$cli`" %*`r`n" | Set-Content -Path $wrapper -Encoding Ascii
}
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$binDir*") {
  [Environment]::SetEnvironmentVariable("Path", "$userPath;$binDir", "User")
  Write-Host "added $binDir to user PATH (open a new PowerShell window to use it)"
}
Write-Host "installed: gl"
Write-Host "next (in a NEW PowerShell window):"
Write-Host "  gl login acc1   # sign in with a Google account (repeat acc2, acc3, ...)"
Write-Host "  gl probe; gl start; gl connect"
