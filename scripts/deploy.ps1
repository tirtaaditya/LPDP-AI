# Production deploy (Windows Server): git pull → npm install → PM2 restart
# Usage (from app root, PowerShell as Admin if needed):
#   .\scripts\deploy.ps1
#   .\scripts\deploy.ps1 -SkipPull
#   .\scripts\deploy.ps1 -Branch main

param(
  [string]$Branch = "main",
  [string]$AppName = "ai-lpdp",
  [switch]$SkipPull,
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

Write-Host "==> Deploy root: $Root"
Write-Host "==> Node: $(node -v)"
Write-Host "==> npm:  $(npm -v)"

if (-not (Test-Path ".env")) {
  throw ".env missing. Copy .env.example to .env and configure DB_*/secrets."
}

New-Item -ItemType Directory -Force -Path "logs", "uploads", "public\generated" | Out-Null

function Get-FileHashSafe([string]$Path) {
  if (-not (Test-Path $Path)) { return "" }
  return (Get-FileHash -Algorithm SHA256 -Path $Path).Hash
}

$lockBefore = Get-FileHashSafe "package-lock.json"
$pkgBefore = Get-FileHashSafe "package.json"

if (-not $SkipPull) {
  Write-Host "==> git fetch / pull ($Branch)"
  git fetch --all --prune
  git checkout $Branch
  git pull --ff-only origin $Branch
} else {
  Write-Host "==> skip git pull"
}

if (-not $SkipInstall) {
  $lockAfter = Get-FileHashSafe "package-lock.json"
  $pkgAfter = Get-FileHashSafe "package.json"
  Write-Host "==> npm install --omit=dev"
  # Yes: after pull, run install (needed when package.json/lock changes; safe always)
  npm install --omit=dev
  if ($lockBefore -ne $lockAfter -or $pkgBefore -ne $pkgAfter) {
    Write-Host "==> Dependencies changed on this pull."
  } else {
    Write-Host "==> package.json/lock unchanged (install still verified node_modules)."
  }
} else {
  Write-Host "==> skip npm install"
}

$pm2 = Get-Command pm2 -ErrorAction SilentlyContinue
if ($pm2) {
  Write-Host "==> PM2 restart ($AppName)"
  $exists = pm2 describe $AppName 2>$null
  if ($LASTEXITCODE -eq 0) {
    pm2 restart $AppName --update-env
  } else {
    pm2 start ecosystem.config.cjs
  }
  pm2 save
  pm2 status
  Write-Host "==> Recent logs:"
  pm2 logs $AppName --lines 30 --nostream
} else {
  Write-Host "WARN: pm2 not found. Start manually: npm start"
}

Write-Host ""
Write-Host "DONE."
Write-Host "Notes:"
Write-Host "  - npm install: YES after pull if package.json / lock changed"
Write-Host "  - DB migrate runs automatically on app start"
Write-Host "  - Keep .env out of git; do not overwrite production secrets"
