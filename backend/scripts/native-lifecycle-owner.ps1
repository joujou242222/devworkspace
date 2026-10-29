param(
  [Parameter(Mandatory=$true)][int]$ProcessId,
  [Parameter(Mandatory=$true)][string]$StartedUTC
)
$ErrorActionPreference = 'Stop'
try {
  $current = Get-Process -Id $ProcessId -ErrorAction Stop
  if ($current.StartTime.ToUniversalTime().ToString('o') -ceq $StartedUTC) { Write-Output 'ACTIVE' }
  else { Write-Output 'REUSED' }
} catch {
  Write-Output 'MISSING'
}
