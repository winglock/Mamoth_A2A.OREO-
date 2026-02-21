$ErrorActionPreference = "SilentlyContinue"

Write-Host "[mammoth] stopping listeners on ports 7340 and 7450..."

$ports = @(7340, 7450)
foreach ($p in $ports) {
  $cons = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $p -State Listen
  foreach ($c in $cons) {
    Stop-Process -Id $c.OwningProcess -Force
    Write-Host "stopped pid=$($c.OwningProcess) port=$p"
  }
}

Write-Host "[mammoth] done"

