param(
 [Parameter(Mandatory=$true)][ValidateSet('setup','run','rollback')][string]$Action,
 [string]$RequestFile
)
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Split-Path $PSScriptRoot))
$sandboxRoot=Join-Path $projectRoot '.local\processing'
$statePath=Join-Path $sandboxRoot 'sandbox.json'
New-Item -ItemType Directory -Force -Path $sandboxRoot | Out-Null
$guardPath=Join-Path $sandboxRoot 'lifecycle.lock'
if(-not(Test-Path -LiteralPath $guardPath)){[IO.File]::WriteAllText($guardPath,'')}
# Keep this handle for the whole launcher lifetime. Mutations require exclusive
# ownership; running jobs share read access and prevent setup/rollback races.
if($Action -eq 'run'){$guard=[IO.File]::Open($guardPath,'Open','Read','Read')}
else{$guard=[IO.File]::Open($guardPath,'Open','ReadWrite','None')}
Add-Type -Path (Join-Path $PSScriptRoot 'processing-sandbox.cs')
function Under([string]$path,[string]$root) {
 $full=[IO.Path]::GetFullPath($path)
 if (-not $full.StartsWith(([IO.Path]::GetFullPath($root)+'\'),[StringComparison]::OrdinalIgnoreCase)) { throw 'Path escapes dedicated sandbox directory' }
 return $full
}
function Grant([string]$path,[System.Security.Principal.SecurityIdentifier]$sid,[System.Security.AccessControl.FileSystemRights]$rights) {
 $acl=Get-Acl -LiteralPath $path
 $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,$rights,'ContainerInherit,ObjectInherit','None','Allow')
 $acl.AddAccessRule($rule)
 Set-Acl -LiteralPath $path -AclObject $acl
}
if ($Action -eq 'setup') {
 New-Item -ItemType Directory -Force -Path $sandboxRoot | Out-Null
 if (Test-Path -LiteralPath $statePath) {
  $state=Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
  if($state.root -ne $projectRoot){throw 'Sandbox belongs to another project'}
 } else {
 $sha=[Security.Cryptography.SHA256]::Create()
 $name='DevWorkspace.Phase4.'+([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($projectRoot.ToLowerInvariant()))).Replace('-','').Substring(0,16))
 $profile=[ProcessingSandbox]::Profile($name,$true)
 $sid=New-Object System.Security.Principal.SecurityIdentifier($profile.Sid)
 $tools=Join-Path $sandboxRoot 'tools'
 $work=Join-Path $sandboxRoot 'work'
 New-Item -ItemType Directory -Force -Path $tools,$work | Out-Null
 $snapshots=@()
 foreach($path in @($tools,$work,$profile.Directory,(Split-Path $profile.Directory))) { $snapshots+=@{path=$path;sddl=(Get-Acl -LiteralPath $path).Sddl} }
 $state=@{root=$projectRoot;name=$name;sid=$profile.Sid;profileDirectory=$profile.Directory;tools=$tools;work=$work;aclSnapshots=$snapshots;capabilities=@();schema=1}
 $state | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $statePath -Encoding UTF8
 }
 $sid=New-Object System.Security.Principal.SecurityIdentifier($state.sid)
 Grant $state.tools $sid 'ReadAndExecute'
 Grant $state.work ([Security.Principal.WindowsIdentity]::GetCurrent().User) 'FullControl'
 $workAcl=Get-Acl -LiteralPath $state.work
 $workAcl.PurgeAccessRules($sid)
 Set-Acl -LiteralPath $state.work -AclObject $workAcl
 Grant $state.work $sid 'ReadAndExecute'
 & icacls.exe $state.work /setintegritylevel '(OI)(CI)L' | Out-Null
 if($LASTEXITCODE -ne 0){throw 'Cannot set sandbox work-directory low integrity'}
 # AppContainer's automatically-created profile must not become a second write area.
 $profileRoot=Split-Path $state.profileDirectory
 if(-not($state.aclSnapshots | Where-Object {$_.path -eq $profileRoot})) {
  $state.aclSnapshots+=@{path=$profileRoot;sddl=(Get-Acl -LiteralPath $profileRoot).Sddl}
  $state | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $statePath -Encoding UTF8
 }
 $profileAcl=Get-Acl -LiteralPath $profileRoot
 $everyone=New-Object System.Security.Principal.SecurityIdentifier('S-1-1-0')
 $deny=New-Object System.Security.AccessControl.FileSystemAccessRule($everyone,'Write,Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership','ContainerInherit,ObjectInherit','None','Deny')
 $profileAcl.AddAccessRule($deny)
 Set-Acl -LiteralPath $profileRoot -AclObject $profileAcl
 $state | ConvertTo-Json -Depth 5
 exit 0
}
$state=Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
if($state.root -ne $projectRoot -or $state.name -notmatch '^DevWorkspace\.Phase4\.[A-F0-9]{16}$'){throw 'Unrecognized sandbox state'}
if($Action -eq 'run') {
 $exemptions=& CheckNetIsolation.exe LoopbackExempt -s
 if($LASTEXITCODE -ne 0 -or ($exemptions -join "`n").Contains($state.sid)){throw 'Sandbox loopback-isolation verification failed'}
}
if($Action -eq 'rollback') {
 & icacls.exe $state.work /setintegritylevel '(OI)(CI)M' | Out-Null
 if($LASTEXITCODE -ne 0){throw 'Failed to restore owned work directory integrity label'}
 foreach($entry in ($state.aclSnapshots | Sort-Object {$_.path.Length})) {
  if($entry.path -ne $state.tools -and $entry.path -ne $state.work -and $entry.path -ne $state.profileDirectory -and $entry.path -ne (Split-Path $state.profileDirectory)){throw 'Unexpected ACL rollback target'}
  if(-not(Test-Path -LiteralPath $entry.path)){continue}
  $acl=Get-Acl -LiteralPath $entry.path
  $acl.SetSecurityDescriptorSddlForm($entry.sddl)
  Set-Acl -LiteralPath $entry.path -AclObject $acl
 }
 $result=[ProcessingSandbox]::DeleteAppContainerProfile($state.name)
 if($result -ne 0){[Runtime.InteropServices.Marshal]::ThrowExceptionForHR($result)}
 Move-Item -LiteralPath $statePath -Destination ($statePath+'.retired-'+[DateTimeOffset]::UtcNow.ToUnixTimeSeconds())
 Write-Output 'Dedicated AppContainer removed; prior ACLs restored; project tools/work files retained.'
 exit 0
}
$inputPath=Under $RequestFile $sandboxRoot
$request=Get-Content -LiteralPath $inputPath -Raw | ConvertFrom-Json
$exe=Under $request.executable $state.tools
if([IO.Path]::GetFileName($exe) -notin @('node.exe','clamscan.exe')){throw 'Unsupported processing executable'}
$work=Under $request.directory $state.work
if(-not(Test-Path -LiteralPath $work -PathType Container)){throw 'Job directory unavailable'}
$jobSid=New-Object System.Security.Principal.SecurityIdentifier($state.sid)
Grant $work $jobSid 'ReadAndExecute,Write,DeleteSubdirectoriesAndFiles'
$jobAcl=Get-Acl -LiteralPath $work
$jobAcl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($jobSid,'Delete','None','None','Deny')))
Set-Acl -LiteralPath $work -AclObject $jobAcl
$result=[ProcessingSandbox]::Run($state.name,$exe,[string[]]$request.arguments,$work,[int]$request.timeoutMs,[int]$request.memoryMiB)
$result | ConvertTo-Json -Compress
