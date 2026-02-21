param(
  [string]$RepoPath = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($RepoPath)) {
  $RepoPath = Split-Path -Parent $PSScriptRoot
}

if (-not (Test-Path $RepoPath)) {
  throw "Repo path not found: $RepoPath"
}

function Start-MammothWindow {
  param(
    [string]$Title,
    [string]$Command
  )

  $full = @(
    "-NoProfile",
    "-NoExit",
    "-Command",
    "`$host.UI.RawUI.WindowTitle='$Title'; Set-Location '$RepoPath'; $Command"
  )

  Start-Process -FilePath "powershell.exe" -ArgumentList $full | Out-Null
}

Write-Host "[mammoth] repo: $RepoPath"
Write-Host "[mammoth] starting daemon + observer in separate PowerShell windows..."

Start-MammothWindow -Title "Mammoth Daemon" -Command "node services/node-daemon/server.mjs"
Start-MammothWindow -Title "Mammoth Observer" -Command "node apps/observer-web/server.mjs"

Start-Sleep -Seconds 1

Write-Host ""
Write-Host "Open these URLs:"
Write-Host "  Node health:    http://127.0.0.1:7340/health"
Write-Host "  Observer UI:    http://127.0.0.1:7450/"
Write-Host ""
Write-Host "Onboarding:"
Write-Host "  npm run quickstart"
Write-Host "  npm run doctor"
Write-Host "  npm run tui"
