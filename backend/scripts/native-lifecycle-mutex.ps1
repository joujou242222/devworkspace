param(
  [Parameter(Mandatory=$true)][string]$Root,
  [Parameter(Mandatory=$true)][int]$ParentPid
)
$ErrorActionPreference = 'Stop'
$fullRoot = [IO.Path]::GetFullPath($Root)
$sha = [Security.Cryptography.SHA256]::Create()
$hash = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($fullRoot.ToLowerInvariant())))).Replace('-', '').ToLowerInvariant().Substring(0,32)
$sha.Dispose()
$mutex = [Threading.Mutex]::new($false, "Local\DevWorkspaceNative-$hash")
if (-not $mutex.WaitOne(0)) {
  [Console]::Out.WriteLine('BUSY')
  [Console]::Out.Flush()
  exit 3
}
try {
  $parent = Get-Process -Id $ParentPid -ErrorAction Stop
  $owner = [ordered]@{
    status = 'LOCKED'
    pid = $ParentPid
    startedUTC = $parent.StartTime.ToUniversalTime().ToString('o')
  }
  [Console]::Out.WriteLine(($owner | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
  while ($null -ne [Console]::ReadLine()) { }
} finally {
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
