param(
  [Parameter(Mandatory=$true)][ValidateSet('start','stop','inspect')][string]$Action,
  [Parameter(Mandatory=$true)][string]$Record
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$entry = Get-Content -LiteralPath $Record -Raw | ConvertFrom-Json
$projectRoot = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot))
if ($entry.root -ne $projectRoot) { throw 'Process record belongs to another project' }
$root = [IO.Path]::GetFullPath((Join-Path (Split-Path $PSScriptRoot) '.local\vendor')) + '\'
if (-not ([IO.Path]::GetFullPath($entry.binary).StartsWith($root, [StringComparison]::OrdinalIgnoreCase))) { throw 'Executable outside project vendor directory' }
if ($Action -eq 'start') {
  if ($entry.pid) { throw 'Record already has a PID' }
  $arguments = @($entry.args | ForEach-Object { if ($_ -match '["\r\n]') { throw 'Invalid argument' }; '"' + $_ + '"' })
  $child = Start-Process -FilePath $entry.binary -ArgumentList $arguments -WorkingDirectory $entry.cwd -WindowStyle Hidden -RedirectStandardOutput $entry.stdout -RedirectStandardError $entry.stderr -PassThru
  $entry | Add-Member -NotePropertyName pid -NotePropertyValue $child.Id
  $entry | Add-Member -NotePropertyName startedUTC -NotePropertyValue $child.StartTime.ToUniversalTime().ToString('o')
  $entry | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $Record -Encoding UTF8
  exit 0
}
$current = Get-Process -Id $entry.pid -ErrorAction SilentlyContinue
if (-not $current) { if ($Action -eq 'inspect') { Write-Output 'false' }; exit 0 }
if ($current.Path -ne $entry.binary -or $current.StartTime.ToUniversalTime().ToString('o') -ne $entry.startedUTC) { throw 'PID ownership mismatch' }
if ($Action -eq 'inspect') { Write-Output 'true'; exit 0 }
# Send CTRL_C through the owned console; never use Stop-Process or taskkill /F.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NativeConsole {
 [DllImport("kernel32.dll", SetLastError=true)] public static extern bool FreeConsole();
 [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AttachConsole(uint pid);
 [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add);
 [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GenerateConsoleCtrlEvent(uint code, uint group);
}
'@
[NativeConsole]::FreeConsole() | Out-Null
if (-not [NativeConsole]::AttachConsole([uint32]$entry.pid)) { throw 'Cannot attach owned console; refusing forced shutdown' }
[NativeConsole]::SetConsoleCtrlHandler([IntPtr]::Zero,$true) | Out-Null
if (-not [NativeConsole]::GenerateConsoleCtrlEvent(0,0)) { throw 'Cannot deliver graceful CTRL_C' }
if (-not $current.WaitForExit(30000)) { throw 'Graceful shutdown timed out; no force used' }
[NativeConsole]::FreeConsole() | Out-Null
# The non-interactive helper must not leave PowerShell attached to a retired
# application's console while its host tears down. The application is exited.
[Environment]::Exit(0)
