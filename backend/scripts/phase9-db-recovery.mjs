import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { Browser } from '../tests/phase2/helpers.mjs';
import { request } from './http.mjs';

const fixture = JSON.parse(await readFile('.local/phase9/workload-fixture.json', 'utf8'));
const processRecord = JSON.parse(await readFile('.local/processes.json', 'utf8'));
if (processRecord.root !== process.cwd())
  throw new Error('The application process record belongs to another checkout');
const appPids = (processRecord.children ?? [])
  .map((entry) => Number(entry.pid))
  .filter(Number.isSafeInteger);
if (appPids.length !== 4) throw new Error('Expected the four owned application processes');
function assertAppProcessesRemainRunning() {
  execFileSync(
    'powershell.exe',
    ['-NoProfile', '-Command', `Get-Process -Id ${appPids.join(',')} -ErrorAction Stop | Out-Null`],
    { windowsHide: true, timeout: 10000 },
  );
}
assertAppProcessesRemainRunning();

const native = (command) =>
  execFileSync(process.execPath, ['scripts/native-infra.mjs', command], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120000,
    maxBuffer: 1024 * 1024,
  });
const wait = (ms) => new Promise((yes) => setTimeout(yes, ms));
const browser = new Browser();
await browser.login(fixture.email);
const before = await request('/api/v1/health/ready');
if (before.status !== 200) throw new Error('API/PostgreSQL were not ready before the outage probe');
const principalResponse = await browser.request('/api/v1/me/principals');
if (principalResponse.status !== 200) throw new Error('Unable to establish the probe principal');
const principal = principalResponse
  .json()
  .items.find((entry) => entry.organizationId === fixture.organizationId);
if (!principal) throw new Error('The workload organization principal was not available');

let sourceWasStopped = false;
let sourceWasRestored = false;
const evidence = {
  startedAt: new Date().toISOString(),
  appPidsRemainOwned: appPids.length,
  apiHealthyBefore: before.status,
  status: 'INCOMPLETE',
};
try {
  sourceWasStopped = true;
  evidence.shutdown = JSON.parse(native('down'));
  const unavailable = await request('/api/v1/health/ready');
  evidence.apiReadyDuringPostgresOutage = unavailable.status;
  if (unavailable.status !== 503 || unavailable.json().postgres !== 'unavailable')
    throw new Error('The live API did not report PostgreSQL unavailability as not-ready/503');
  assertAppProcessesRemainRunning();
  evidence.appProcessesStayedUpDuringOutage = true;

  const recoveryStarted = performance.now();
  evidence.startup = JSON.parse(native('up'));
  sourceWasRestored = true;
  let recovered;
  let lastError;
  while (performance.now() - recoveryStarted < 60000) {
    try {
      const response = await request('/api/v1/health/ready');
      if (response.status === 200 && response.json().postgres === 'restricted-runtime-connected') {
        recovered = response;
        break;
      }
      lastError = new Error(`Readiness returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await wait(250);
  }
  if (!recovered)
    throw new Error(`The live API pool did not reconnect within 60 seconds: ${lastError?.message}`);
  evidence.apiReadyAfterRestartMs = Number((performance.now() - recoveryStarted).toFixed(2));
  evidence.apiReadyAfterPostgresRestart = recovered.status;
  assertAppProcessesRemainRunning();
  evidence.appProcessesStayedUpAfterRestart = true;

  const me = await browser.me();
  const tasks = await browser.request(
    `/api/v1/organizations/${fixture.organizationId}/projects/${fixture.projectId}/tasks?limit=25&page=4`,
    'GET',
    undefined,
    { 'X-Organization-Principal': principal.id },
  );
  if (tasks.status !== 200 || tasks.json().total !== fixture.taskCount)
    throw new Error('Authenticated task reads did not recover through the original API pool');
  evidence.authenticatedSessionAfterRestart = me.id ? 'usable' : 'missing-user-id';
  evidence.authenticatedTaskReadAfterRestart = {
    status: tasks.status,
    total: tasks.json().total,
    page: tasks.json().page,
  };
  evidence.status = 'PASS';
} finally {
  if (sourceWasStopped && !sourceWasRestored) {
    evidence.emergencyRestart = JSON.parse(native('up'));
    sourceWasRestored = true;
  }
  await mkdir('.local/phase9', { recursive: true });
  evidence.completedAt = new Date().toISOString();
  await writeFile(
    '.local/phase9/db-recovery-results.json',
    JSON.stringify(evidence, null, 2) + '\n',
    {
      mode: 0o600,
    },
  );
}
console.log(JSON.stringify(evidence));
