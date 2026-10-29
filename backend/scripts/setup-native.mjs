import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

export const windowsEnv = {
  ...process.env,
  PSModulePath: process.env.SystemRoot + '\\System32\\WindowsPowerShell\\v1.0\\Modules',
};
export function ps(code) {
  return execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-EncodedCommand',
      Buffer.from(
        "$ProgressPreference='SilentlyContinue';$ErrorActionPreference='Stop';" + code,
        'utf16le',
      ).toString('base64'),
    ],
    { encoding: 'utf8', windowsHide: true, env: windowsEnv, maxBuffer: 4 * 1024 * 1024 },
  ).replace(/^\uFEFF/, '');
}
export const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
export async function diskGuard() {
  const volumes = JSON.parse(
    ps('Get-Volume -DriveLetter C,D | Select-Object DriveLetter,SizeRemaining | ConvertTo-Json'),
  );
  for (const volume of volumes) {
    const minimum = (volume.DriveLetter === 'C' ? 5 : 20) * 1024 ** 3;
    if (volume.SizeRemaining < minimum) throw new Error('Low disk space on ' + volume.DriveLetter);
  }
  return volumes;
}
if (process.argv[1] === resolve('scripts/setup-native.mjs')) {
  if (process.platform !== 'win32') throw new Error('Native setup is Windows-only');
  await diskGuard();
  const tools = JSON.parse(await readFile('infra/native-tools.json', 'utf8'));
  await mkdir('.local/vendor/native-downloads', { recursive: true });
  const evidence = {};
  for (const [name, tool] of Object.entries(tools)) {
    await diskGuard();
    const archive = resolve('.local/vendor/native-downloads', name + '-' + tool.version + '.zip');
    let valid = false;
    try {
      valid =
        createHash('sha256')
          .update(await readFile(archive))
          .digest('hex') === tool.sha256;
    } catch {}
    if (!valid) {
      execFileSync(
        'curl.exe',
        [
          '--fail',
          '--location',
          '--silent',
          '--show-error',
          '--connect-timeout',
          '15',
          '--max-time',
          '180',
          '--output',
          archive,
          tool.url,
        ],
        { windowsHide: true },
      );
    }
    const bytes = await readFile(archive);
    if (createHash('sha256').update(bytes).digest('hex') !== tool.sha256)
      throw new Error('Archive digest mismatch: ' + name);
    if (
      tool.sha512base64 &&
      createHash('sha512').update(bytes).digest('base64') !== tool.sha512base64
    )
      throw new Error('NuGet catalog digest mismatch');
    const destination = resolve('.local/vendor', name + '-' + tool.version);
    ps(
      `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::OpenRead(${quote(archive)}); foreach($e in $z.Entries){ if($e.FullName -match '(^[/\\\\]|\\.\\.|^[A-Za-z]:)'){throw 'Unsafe archive entry'} }; $z.Dispose(); if(-not(Test-Path -LiteralPath ${quote(destination)})){Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(destination)}}`,
    );
    const binary = resolve(destination, tool.binary);
    await access(binary);
    const archivedHash = ps(
      `Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::OpenRead(${quote(archive)}); try { $e=$z.GetEntry(${quote(tool.binary)}); if(-not $e){throw 'Binary missing from verified archive'}; $s=$e.Open(); try { [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($s)).Replace('-','').ToLowerInvariant() } finally {$s.Dispose()} } finally {$z.Dispose()}`,
    ).trim();
    if (
      createHash('sha256')
        .update(await readFile(binary))
        .digest('hex') !== archivedHash
    )
      throw new Error('Existing executable differs from verified archive: ' + name);
    if (name === 'memurai') {
      const signature = JSON.parse(
        ps(
          `Get-AuthenticodeSignature -LiteralPath ${quote(binary)} | Select-Object @{N='Status';E={$_.Status.ToString()}},@{N='Signer';E={$_.SignerCertificate.Subject}} | ConvertTo-Json`,
        ),
      );
      if (signature.Status !== 'Valid' || !signature.Signer.includes('Janea Systems'))
        throw new Error('Memurai signature verification failed');
    }
    evidence[name] = {
      ...tool,
      binary,
      binarySha256: createHash('sha256')
        .update(await readFile(binary))
        .digest('hex'),
    };
    console.log('Verified project-local tool: ' + name + ' ' + tool.version);
  }
  await mkdir('.local/native', { recursive: true });
  await writeFile('.local/native/artifacts.json', JSON.stringify(evidence, null, 2));
  await diskGuard();
}
