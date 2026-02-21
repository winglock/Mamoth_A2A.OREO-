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

$logDir = Join-Path $RepoPath "runtime-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$daemonOut = Join-Path $logDir "daemon.out.log"
$daemonErr = Join-Path $logDir "daemon.err.log"
$observerOut = Join-Path $logDir "observer.out.log"
$observerErr = Join-Path $logDir "observer.err.log"

function Stop-ListenersOnPort {
  param(
    [int[]]$Ports
  )

  $killedAny = $false
  foreach ($port in $Ports) {
    $listeners = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($listener in $listeners) {
      $ownerPid = $listener.OwningProcess
      if ($ownerPid) {
        Stop-Process -Id $ownerPid -Force -ErrorAction SilentlyContinue
        Write-Host "[mammoth] stopped existing listener pid=$ownerPid port=$port"
        $killedAny = $true
      }
    }
  }
  if ($killedAny) {
    Start-Sleep -Milliseconds 400
  }
}

function Wait-AnyProcessExit {
  param(
    [int[]]$Pids
  )

  while ($true) {
    foreach ($procId in $Pids) {
      if (-not (Get-Process -Id $procId -ErrorAction SilentlyContinue)) {
        return
      }
    }
    Start-Sleep -Milliseconds 500
  }
}

function Ensure-ProcessStarted {
  param(
    [System.Diagnostics.Process]$Process,
    [string]$Name,
    [string]$ErrLog
  )

  Start-Sleep -Milliseconds 300
  if (-not (Get-Process -Id $Process.Id -ErrorAction SilentlyContinue)) {
    Write-Host "[mammoth] $Name failed to start. Last error log lines:"
    if (Test-Path $ErrLog) {
      Get-Content $ErrLog -Tail 30 | ForEach-Object { Write-Host "  $_" }
    }
    throw "$Name failed to start"
  }
}

Write-Host "[mammoth] repo: $RepoPath"
Write-Host "[mammoth] checking for existing listeners on 7340/7450..."
Stop-ListenersOnPort -Ports @(7340, 7450)
Write-Host "[mammoth] starting daemon + observer..."

$daemon = Start-Process -FilePath "node" -ArgumentList "services/node-daemon/server.mjs" -WorkingDirectory $RepoPath -PassThru -RedirectStandardOutput $daemonOut -RedirectStandardError $daemonErr
Ensure-ProcessStarted -Process $daemon -Name "daemon" -ErrLog $daemonErr
Start-Sleep -Milliseconds 500
$observer = Start-Process -FilePath "node" -ArgumentList "apps/observer-web/server.mjs" -WorkingDirectory $RepoPath -PassThru -RedirectStandardOutput $observerOut -RedirectStandardError $observerErr
Ensure-ProcessStarted -Process $observer -Name "observer" -ErrLog $observerErr

Write-Host "[mammoth] daemon pid=$($daemon.Id)"
Write-Host "[mammoth] observer pid=$($observer.Id)"
Write-Host ""
Write-Host "Open:"
Write-Host "  http://127.0.0.1:7450/"
Write-Host "  http://127.0.0.1:7340/health"
Write-Host ""
Write-Host "Bootstrap:"
Write-Host "  npm run quickstart"
Write-Host "  npm run doctor"
Write-Host "  npm run tui"
Write-Host ""
Write-Host "Press Ctrl+C to stop both."

try {
  Wait-AnyProcessExit -Pids @($daemon.Id, $observer.Id)
}
finally {
  foreach ($p in @($daemon, $observer)) {
    if ($p -and -not $p.HasExited) {
      Stop-Process -Id $p.Id -Force
    }
  }
  Write-Host "[mammoth] stopped"
}
