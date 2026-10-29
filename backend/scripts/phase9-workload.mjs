import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { account, admin, join, tenant } from '../tests/phase2/helpers.mjs';

const root = resolve('.');
const outputPath = resolve('.local/phase9/workload-results.json');
const fixturePath = resolve('.local/phase9/workload-fixture.json');
const rows = 100;
const documentRows = 1000;
const projectCount = 10;
const concurrency = 4;
const measurements = {};
const summarize = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (fraction) => sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)] ?? 0;
  return {
    samples: sorted.length,
    minMs: Number((sorted[0] ?? 0).toFixed(2)),
    medianMs: Number(at(0.5).toFixed(2)),
    p95Ms: Number(at(0.95).toFixed(2)),
    maxMs: Number((sorted.at(-1) ?? 0).toFixed(2)),
  };
};

async function concurrentMap(items, limit, work) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const index = next++;
        if (index >= items.length) return;
        results[index] = await work(items[index], index);
      }
    }),
  );
  return results;
}

async function appMemory() {
  const record = JSON.parse(await readFile('.local/processes.json', 'utf8'));
  if (record.root !== root)
    throw new Error('The running app process record belongs to another checkout');
  const pids = (record.children ?? []).map((entry) => Number(entry.pid)).filter(Number.isInteger);
  if (!pids.length) throw new Error('No owned app process IDs were recorded');
  const output = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Get-Process -Id ${pids.join(',')} -ErrorAction Stop | Select-Object Id,ProcessName,WorkingSet64,CPU | ConvertTo-Json -Compress`,
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 10000 },
  );
  const parsed = JSON.parse(output);
  const processes = Array.isArray(parsed) ? parsed : [parsed];
  return {
    processes: processes.map((entry) => ({
      name: entry.ProcessName,
      rssBytes: Number(entry.WorkingSet64),
      cpuSeconds: Number(entry.CPU),
    })),
    totalRssBytes: processes.reduce((sum, entry) => sum + Number(entry.WorkingSet64), 0),
  };
}

async function call(owner, t, path, method = 'GET', body, headers = {}) {
  const start = performance.now();
  const response = await owner.browser.request(t.path + path, method, body, {
    ...t.headers,
    ...headers,
  });
  return { response, elapsedMs: performance.now() - start };
}

async function requireJson(result, status, label) {
  if (result.response.status !== status)
    throw new Error(
      `${label} returned HTTP ${result.response.status}: ${result.response.body.slice(0, 240)}`,
    );
  return result.response.json();
}

function flattenPlan(plan, values = []) {
  values.push(plan['Node Type']);
  for (const child of plan.Plans ?? []) flattenPlan(child, values);
  return values;
}

async function main() {
  await mkdir(resolve('.local/phase9'), { recursive: true });
  const startedAt = new Date().toISOString();
  const memoryBefore = await appMemory();
  const owner = await account();
  const t = await tenant(owner, 'Phase 9 bounded workload');
  const invitee = await account();
  const invited = await join(owner, t, invitee);
  const clientResult = await call(owner, t, '/clients', 'POST', {
    name: 'Phase 9 workload client',
    description: 'Bounded local verification fixture',
    status: 'ACTIVE',
  });
  const client = await requireJson(clientResult, 201, 'Create workload client');
  const projectBody = (name) => ({
    client_id: client.id,
    name,
    description: 'Bounded Phase 9 fixture',
    status: 'ACTIVE',
    portal_enabled: true,
    due_at: null,
  });
  const projects = [];
  const projectLatencies = [];
  for (let index = 0; index < projectCount; index++) {
    const result = await call(
      owner,
      t,
      '/projects',
      'POST',
      projectBody(`Phase 9 workload ${index + 1}`),
    );
    projects.push(await requireJson(result, 201, 'Create workload project'));
    projectLatencies.push(result.elapsedMs);
  }
  const project = projects[0];
  const memberResult = await call(owner, t, `/projects/${project.id}/members`, 'POST', {
    membership_id: invited.principal.id,
    role: 'CONTRIBUTOR',
    status: 'ACTIVE',
  });
  const projectMember = await requireJson(memberResult, 201, 'Add workload contributor');

  const taskInputs = Array.from({ length: rows }, (_, index) => ({
    title: `Phase 9 workload task ${String(index + 1).padStart(3, '0')}`,
    description: 'Bounded local workload fixture',
    milestone_id: null,
    assignee_id: projectMember.id,
    priority: 'NORMAL',
    status: 'TODO',
    due_at: null,
    position: index,
  }));
  const taskLatencies = [];
  const tasks = await concurrentMap(taskInputs, concurrency, async (body) => {
    const result = await call(owner, t, `/projects/${project.id}/tasks`, 'POST', body, {
      'Idempotency-Key': crypto.randomUUID(),
    });
    const task = await requireJson(result, 201, 'Create workload task');
    taskLatencies.push(result.elapsedMs);
    return task;
  });

  const milestoneInputs = Array.from({ length: rows }, (_, index) => ({
    title: `Phase 9 workload milestone ${String(index + 1).padStart(3, '0')}`,
    due_at: null,
    position: index,
    status: 'OPEN',
  }));
  const milestoneLatencies = [];
  const milestones = await concurrentMap(milestoneInputs, concurrency, async (body) => {
    const result = await call(owner, t, `/projects/${project.id}/milestones`, 'POST', body, {
      'Idempotency-Key': crypto.randomUUID(),
    });
    const milestone = await requireJson(result, 201, 'Create workload milestone');
    milestoneLatencies.push(result.elapsedMs);
    return milestone;
  });

  const documentProjects = projects;
  const documentInputs = Array.from({ length: documentRows }, (_, index) => ({
    project_id: documentProjects[index % documentProjects.length].id,
    title: `Phase 9 workload document ${String(index + 1).padStart(4, '0')}`,
    content: {
      version: 1,
      blocks: [{ type: 'paragraph', spans: [{ text: 'Bounded local verification content.' }] }],
    },
  }));
  const documentLatencies = [];
  const documents = await concurrentMap(documentInputs, concurrency, async (body) => {
    const result = await call(owner, t, '/documents', 'POST', body, {
      'Idempotency-Key': crypto.randomUUID(),
    });
    const document = await requireJson(result, 201, 'Create workload document');
    documentLatencies.push(result.elapsedMs);
    return document;
  });

  const taskListLatencies = [];
  const taskPages = await concurrentMap(
    Array.from({ length: 24 }, (_, index) => index),
    concurrency,
    async (index) => {
      const page = (index % 4) + 1;
      const result = await call(owner, t, `/projects/${project.id}/tasks?limit=25&page=${page}`);
      const payload = await requireJson(result, 200, 'Read paged workload tasks');
      taskListLatencies.push(result.elapsedMs);
      if (payload.total !== rows || payload.items.length !== 25 || payload.page !== page)
        throw new Error('Task page/count contract changed during the bounded workload');
      return payload;
    },
  );
  const taskPageFour = taskPages.find((entry) => entry.page === 4);

  const documentFirst = await call(owner, t, '/documents?limit=25');
  const documentFirstPage = await requireJson(
    documentFirst,
    200,
    'Read workload document page one',
  );
  if (
    documentFirstPage.total !== documentRows ||
    documentFirstPage.items.length !== 25 ||
    !documentFirstPage.nextCursor
  )
    throw new Error('Document library first page did not reconcile to the workload size');
  const documentSecond = await call(
    owner,
    t,
    `/documents?limit=25&cursor=${documentFirstPage.nextCursor}`,
  );
  const documentSecondPage = await requireJson(
    documentSecond,
    200,
    'Read workload document page two',
  );
  const firstIds = new Set(documentFirstPage.items.map((entry) => entry.id));
  if (
    documentSecondPage.total !== documentRows ||
    documentSecondPage.items.length !== 25 ||
    documentSecondPage.items.some((entry) => firstIds.has(entry.id))
  )
    throw new Error('Document cursor pages overlap or lose the scoped total');
  const repeatedDocumentReads = await concurrentMap(
    Array.from({ length: 24 }, (_, index) => index),
    concurrency,
    async (index) => {
      const cursor = index % 2 === 0 ? '' : `&cursor=${documentFirstPage.nextCursor}`;
      const result = await call(owner, t, `/documents?limit=25${cursor}`);
      const payload = await requireJson(result, 200, 'Read repeated workload document page');
      if (payload.total !== documentRows || payload.items.length !== 25)
        throw new Error('Repeated document list did not return the expected authorized page');
      return result.elapsedMs;
    },
  );
  const documentListLatencies = [
    documentFirst.elapsedMs,
    documentSecond.elapsedMs,
    ...repeatedDocumentReads,
  ];

  const milestoneListLatencies = [];
  const milestonePageResult = await call(
    owner,
    t,
    `/projects/${project.id}/milestones?limit=100&page=1`,
  );
  const milestonePage = await requireJson(milestonePageResult, 200, 'Read workload milestone page');
  milestoneListLatencies.push(milestonePageResult.elapsedMs);
  if (milestonePage.total !== rows || milestonePage.items.length !== rows)
    throw new Error('Milestone page/count contract changed during the bounded workload');

  const patchLatencies = [];
  await concurrentMap(tasks.slice(0, concurrency), concurrency, async (task, index) => {
    const result = await call(
      owner,
      t,
      `/projects/${project.id}/tasks/${task.id}`,
      'PATCH',
      { ...taskInputs[index], description: 'Bounded concurrent metadata update' },
      { 'If-Match': `"${task.revision}"` },
    );
    await requireJson(result, 200, 'Update independent workload task');
    patchLatencies.push(result.elapsedMs);
  });

  const organizationLock = await admin.connect();
  let lockHeld = false;
  let lockWaitersObserved = 0;
  let lockHeldMs = 0;
  let lockStartedAt = 0;
  let contentionLatencies = [];
  try {
    await organizationLock.query('BEGIN');
    await organizationLock.query('SELECT id FROM public.organization WHERE id=$1 FOR UPDATE', [
      t.organizationId,
    ]);
    lockHeld = true;
    lockStartedAt = performance.now();
    const blockedMutations = concurrentMap(
      tasks.slice(concurrency, concurrency * 2),
      concurrency,
      async (task, offset) => {
        const index = concurrency + offset;
        const result = await call(
          owner,
          t,
          `/projects/${project.id}/tasks/${task.id}`,
          'PATCH',
          { ...taskInputs[index], description: 'Bounded organization lock wait' },
          { 'If-Match': `"${task.revision}"` },
        );
        await requireJson(result, 200, 'Update task behind organization row lock');
        return result.elapsedMs;
      },
    );
    for (let attempt = 0; attempt < 100; attempt++) {
      const waiters = await admin.query(
        `SELECT count(*)::int total FROM pg_stat_activity
         WHERE datname=current_database() AND pid<>pg_backend_pid()
           AND state='active' AND wait_event_type='Lock'`,
      );
      lockWaitersObserved = Math.max(lockWaitersObserved, waiters.rows[0].total);
      if (lockWaitersObserved > 0) break;
      await new Promise((yes) => setTimeout(yes, 20));
    }
    if (!lockWaitersObserved)
      throw new Error('No PostgreSQL lock waiter was observed during the bounded contention probe');
    await organizationLock.query('COMMIT');
    lockHeld = false;
    lockHeldMs = performance.now() - lockStartedAt;
    contentionLatencies = await blockedMutations;
  } finally {
    if (lockHeld) await organizationLock.query('ROLLBACK');
    organizationLock.release();
  }

  const taskPlan = (
    await admin.query(
      `EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON)
       SELECT r.id,r.title,r.status,r.created_at
       FROM public.task r
       WHERE r.organization_id=$1 AND r.project_id=$2
       ORDER BY r.created_at ASC NULLS LAST,r.id ASC LIMIT 25 OFFSET 75`,
      [t.organizationId, project.id],
    )
  ).rows[0]['QUERY PLAN'][0];
  const documentPlan = (
    await admin.query(
      `EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON)
       SELECT d.id,d.project_id,d.created_at
       FROM public.document d
       WHERE d.organization_id=$1 AND d.project_id=ANY($2::uuid[])
       ORDER BY d.created_at DESC,d.id DESC`,
      [t.organizationId, projects.map((entry) => entry.id)],
    )
  ).rows[0]['QUERY PLAN'][0];

  const taskIds = tasks.map((entry) => entry.id);
  let deliveries = { total: 0, completed: 0, pending: 0, p95LagMs: null };
  for (let attempt = 0; attempt < 30; attempt++) {
    const result = await admin.query(
      `SELECT count(*)::int total,
              count(*) FILTER (WHERE d.completed_at IS NOT NULL)::int completed,
              count(*) FILTER (WHERE d.completed_at IS NULL)::int pending,
              percentile_cont(0.95) WITHIN GROUP
                (ORDER BY extract(epoch FROM (d.completed_at-e.created_at))*1000)
                FILTER (WHERE d.completed_at IS NOT NULL) p95_lag_ms
       FROM public.delivery d
       JOIN public.tenant_event e ON e.id=d.event_id
       WHERE d.lane='tenant' AND e.organization_id=$1 AND e.target_id=ANY($2::text[])`,
      [t.organizationId, taskIds],
    );
    deliveries = {
      total: result.rows[0].total,
      completed: result.rows[0].completed,
      pending: result.rows[0].pending,
      p95LagMs: result.rows[0].p95_lag_ms === null ? null : Number(result.rows[0].p95_lag_ms),
    };
    if (deliveries.pending === 0 && deliveries.completed >= rows) break;
    await new Promise((yes) => setTimeout(yes, 250));
  }
  const notifications = Number(
    (
      await admin.query(
        `SELECT count(*)::int total FROM public.notification n
         JOIN public.tenant_event e ON e.id=n.event_id
         WHERE e.organization_id=$1 AND e.target_id=ANY($2::text[])`,
        [t.organizationId, taskIds],
      )
    ).rows[0].total,
  );
  const memoryAfter = await appMemory();
  const processStats = {
    apiCreate: summarize(taskLatencies),
    milestoneCreate: summarize(milestoneLatencies),
    documentCreate: summarize(documentLatencies),
    projectCreate: summarize(projectLatencies),
    taskListApi: summarize(taskListLatencies),
    documentListApi: summarize(documentListLatencies),
    milestoneListApi: summarize(milestoneListLatencies),
    concurrentTaskMutation: summarize(patchLatencies),
    organizationLockContention: summarize(contentionLatencies),
  };
  const results = {
    status: 'MEASURED',
    startedAt,
    finishedAt: new Date().toISOString(),
    environment: {
      os: 'Windows native',
      node: process.version,
      concurrency,
      rows,
      documentRows,
      projects: projectCount,
    },
    localDiagnosticTargets: {
      taskListP95Ms: 500,
      documentListP95Ms: 750,
      concurrentTaskMutationP95Ms: 1500,
      note: 'Local bounded-workload comparison targets only; not product SLAs or production capacity claims.',
    },
    api: processStats,
    observedTargets: {
      taskListP95WithinTarget: processStats.taskListApi.p95Ms <= 500,
      documentListP95WithinTarget: processStats.documentListApi.p95Ms <= 750,
      concurrentMutationP95WithinTarget: processStats.concurrentTaskMutation.p95Ms <= 1500,
    },
    pagination: {
      taskTotal: taskPageFour.total,
      taskPageSize: taskPageFour.items.length,
      documentTotal: documentFirstPage.total,
      documentPageSize: documentFirstPage.items.length,
      documentCursorPagesDisjoint: true,
      milestoneTotal: milestonePage.total,
      milestonePageSize: milestonePage.items.length,
      documentRowsReadByCurrentScopedListQuery: documentRows,
      documentRowsReturnedPerPage: documentFirstPage.items.length,
      implementationNote:
        'The document library authorizes the project-id set in SQL, then currently materializes all matching rows before cursor slicing in application memory.',
    },
    queryPlans: {
      taskPage: {
        planningMs: taskPlan['Planning Time'],
        executionMs: taskPlan['Execution Time'],
        sharedHitBlocks: taskPlan.Plan['Shared Hit Blocks'] ?? 0,
        sharedReadBlocks: taskPlan.Plan['Shared Read Blocks'] ?? 0,
        nodes: flattenPlan(taskPlan.Plan),
      },
      scopedDocumentSet: {
        planningMs: documentPlan['Planning Time'],
        executionMs: documentPlan['Execution Time'],
        actualRows: documentPlan.Plan['Actual Rows'],
        sharedHitBlocks: documentPlan.Plan['Shared Hit Blocks'] ?? 0,
        sharedReadBlocks: documentPlan.Plan['Shared Read Blocks'] ?? 0,
        nodes: flattenPlan(documentPlan.Plan),
      },
    },
    worker: {
      taskEvents: deliveries,
      notificationsMaterialized: notifications,
      completedAllTaskEvents: deliveries.completed >= rows && deliveries.pending === 0,
    },
    organizationLockContention: {
      boundedConcurrentMutations: contentionLatencies.length,
      postgresLockWaitersObserved: lockWaitersObserved,
      heldMs: Number(lockHeldMs.toFixed(2)),
      requestLatencyP95Ms: processStats.organizationLockContention.p95Ms,
      allMutationsCommitted: contentionLatencies.length === concurrency,
    },
    serverMemory: {
      before: memoryBefore,
      after: memoryAfter,
      rssDeltaBytes: memoryAfter.totalRssBytes - memoryBefore.totalRssBytes,
    },
    fixture: {
      organizationId: t.organizationId,
      projectId: project.id,
      projectIds: projects.map((entry) => entry.id),
      taskCount: tasks.length,
      pageFourTaskTitle: taskPageFour.items[0]?.title ?? null,
      milestoneCount: milestones.length,
      documentCount: documents.length,
      email: owner.email,
      createdAt: startedAt,
      retained: true,
    },
  };
  await writeFile(fixturePath, JSON.stringify(results.fixture, null, 2) + '\n', { mode: 0o600 });
  const safeResults = structuredClone(results);
  delete safeResults.fixture.email;
  delete safeResults.fixture.password;
  safeResults.fixture.organizationIdHash = createHash('sha256')
    .update(t.organizationId)
    .digest('hex')
    .slice(0, 16);
  safeResults.fixture.projectIdHash = createHash('sha256')
    .update(project.id)
    .digest('hex')
    .slice(0, 16);
  delete safeResults.fixture.organizationId;
  delete safeResults.fixture.projectId;
  delete safeResults.fixture.projectIds;
  await writeFile(outputPath, JSON.stringify(safeResults, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(safeResults));
}

try {
  await main();
} finally {
  await admin.end();
}
