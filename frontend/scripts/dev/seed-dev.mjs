/**
 * DevWorkspace Real-API Dev Seed Script
 * - Uses ONLY the real HTTP API (no direct DB writes)
 * - Registers user -> verifies via Mailpit -> logs in
 * - Creates: Organization -> Client -> Contact -> Project -> Milestone -> Task + Checklist -> Deliverable
 * - Tests org-scoped GET with X-Organization-Principal
 * - Tests org-scoped mutation with If-Match
 *
 * Usage:
 *   node scripts/dev/seed-dev.mjs
 */

import crypto from 'node:crypto';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const API_BASE = 'http://127.0.0.1:3001/api/v1';
const MAILPIT_BASE = 'http://127.0.0.1:8025/api/v1';
const ORIGIN = 'https://localhost:8443';

// Enforce execution against localhost targets only
for (const target of [API_BASE, MAILPIT_BASE, ORIGIN]) {
  const host = new URL(target).hostname;
  if (!['localhost', '127.0.0.1'].includes(host)) {
    throw new Error(`Safety check failed: refusing to run against non-localhost target "${target}"`);
  }
}

let cookies = {};

function getCookieHeader() {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

function parseCookies(res) {
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const str of setCookie) {
    const parts = str.split(';')[0].split('=');
    const name = parts[0].trim();
    const val = parts.slice(1).join('=').trim();
    if (name) {
      cookies[name] = val;
    }
  }
}

async function apiCall(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});
  headers.set('origin', ORIGIN);

  const cookieHeader = getCookieHeader();
  if (cookieHeader) {
    headers.set('cookie', cookieHeader);
  }

  if (method === 'POST' && !headers.has('Idempotency-Key') && options.idempotencyKey !== false) {
    headers.set('Idempotency-Key', crypto.randomUUID());
  }

  let body = options.body;
  if (body && typeof body === 'object') {
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    body = JSON.stringify(body);
  }

  const url = path.startsWith('http') ? path : `${API_BASE}${path.startsWith('/') ? path : '/' + path}`;
  const res = await fetch(url, { method, headers, body });
  parseCookies(res);

  let data = null;
  const ctype = res.headers.get('content-type') || '';
  if (ctype.includes('application/json')) {
    data = await res.json();
  } else {
    data = await res.text();
  }

  const etag = res.headers.get('etag');
  const revision = etag ? etag.replace(/^"|"$/g, '') : undefined;

  return { status: res.status, ok: res.ok, data, revision, headers: res.headers };
}

async function getCsrfToken() {
  const res = await apiCall('/identity/csrf');
  if (!res.ok) throw new Error(`Failed to fetch CSRF token: ${res.status}`);
  return res.data.token;
}

async function main() {
  console.log('--- Starting DevWorkspace Dev Seed ---');

  const timestamp = Date.now();
  const testEmail = `dev.seed.${timestamp}@example.com`;
  const testPassword = 'Password123!';
  const testName = `Seed Admin ${timestamp.toString().slice(-4)}`;

  // 1. Fetch CSRF token
  console.log('1. Fetching initial CSRF token...');
  let csrf = await getCsrfToken();
  console.log('   CSRF token obtained.');

  // 2. Register user
  console.log(`2. Registering user: ${testEmail}...`);
  const regRes = await apiCall('/identity/register', {
    method: 'POST',
    headers: { 'x-csrf-token': csrf },
    body: { name: testName, email: testEmail, password: testPassword }
  });
  if (!regRes.ok) {
    throw new Error(`Registration failed (${regRes.status}): ${JSON.stringify(regRes.data)}`);
  }
  console.log('   Registration submitted:', regRes.data.message);

  // 3. Fetch verification token from Mailpit
  console.log('3. Checking Mailpit for verification email...');
  let verifyToken = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise((r) => setTimeout(r, 600));
    const mailRes = await fetch(`${MAILPIT_BASE}/messages`);
    if (mailRes.ok) {
      const messages = await mailRes.json();
      const userMail = (messages.messages || []).find((m) =>
        m.To && m.To.some((t) => t.Address.toLowerCase() === testEmail.toLowerCase())
      );
      if (userMail) {
        const detailRes = await fetch(`${MAILPIT_BASE}/message/${userMail.ID}`);
        if (detailRes.ok) {
          const detail = await detailRes.json();
          const match = /https?:\/\/[^\s]+/.exec(detail.Text || '');
          if (match) {
            const url = new URL(match[0]);
            verifyToken = url.searchParams.get('token');
            if (verifyToken) break;
          }
        }
      }
    }
  }

  if (!verifyToken) {
    throw new Error(`Could not find verification token in Mailpit for ${testEmail}`);
  }
  console.log('   Verification token found in Mailpit:', verifyToken.slice(0, 16) + '...');

  // 4. Verify email
  console.log('4. Verifying email address...');
  csrf = await getCsrfToken();
  const verifyRes = await apiCall('/identity/verify', {
    method: 'POST',
    headers: { 'x-csrf-token': csrf },
    body: { token: verifyToken }
  });
  if (!verifyRes.ok) {
    throw new Error(`Verification failed (${verifyRes.status}): ${JSON.stringify(verifyRes.data)}`);
  }
  console.log('   Email verified successfully.');

  // 5. Login
  console.log('5. Logging in to obtain session cookie...');
  csrf = await getCsrfToken();
  const loginRes = await apiCall('/identity/login', {
    method: 'POST',
    headers: { 'x-csrf-token': csrf },
    body: { email: testEmail, password: testPassword }
  });
  if (!loginRes.ok) {
    throw new Error(`Login failed (${loginRes.status}): ${JSON.stringify(loginRes.data)}`);
  }
  console.log('   Login successful. Session established.');

  // 6. Check /me and verify empty principals initially
  const meRes = await apiCall('/me');
  console.log('   Logged in user:', meRes.data.email, `(id: ${meRes.data.id})`);

  const initialPrincipals = await apiCall('/me/principals');
  console.log('   Initial principals count:', initialPrincipals.data?.items?.length || 0);

  // 7. Create Organization (Onboarding)
  console.log('6. Creating organization (Onboarding)...');
  csrf = await getCsrfToken();
  console.log('   Cookies before org creation:', Object.keys(cookies));
  const orgRes = await apiCall('/organizations', {
    method: 'POST',
    headers: { 'x-csrf-token': csrf },
    body: {
      name: `Studio Alpha ${timestamp.toString().slice(-4)}`,
      description: 'Creative Production & Delivery Studio',
      timezone: 'UTC'
    }
  });
  console.log('   Set-Cookie from org creation:', orgRes.headers.getSetCookie ? orgRes.headers.getSetCookie() : []);
  console.log('   Cookies after org creation:', Object.keys(cookies));
  if (!orgRes.ok) {
    throw new Error(`Organization creation failed (${orgRes.status}): ${JSON.stringify(orgRes.data)}`);
  }
  const orgId = orgRes.data.organizationId || orgRes.data.id;
  const org = { id: orgId, ...orgRes.data };
  console.log('   Organization created (id:', orgId, ')');

  // Re-authenticate because backend trigger deletes session on membership change
  console.log('   Re-authenticating after organization bootstrap (privilege fail-closed)...');
  csrf = await getCsrfToken();
  await apiCall('/identity/login', {
    method: 'POST',
    headers: { 'x-csrf-token': csrf },
    body: { email: testEmail, password: testPassword }
  });

  // 8. Fetch principals to get active X-Organization-Principal
  console.log('7. Fetching updated principals...');
  const princRes = await apiCall('/me/principals');
  console.log('   princRes status:', princRes.status, 'data:', JSON.stringify(princRes.data));
  const principals = princRes.data?.items || [];
  const activePrincipal = principals.find((p) => (p.organizationId || p.organization_id) === orgId) || principals[0];
  if (!activePrincipal) {
    throw new Error('No organization principal found after org creation');
  }
  const principalId = activePrincipal.id;
  console.log('   Active Organization Principal ID:', principalId, `(role: ${activePrincipal.role})`);

  // 9. Create Client
  console.log('8. Creating client...');
  csrf = await getCsrfToken();
  const clientRes = await apiCall(`/organizations/${org.id}/clients`, {
    method: 'POST',
    headers: {
      'x-csrf-token': csrf,
      'x-organization-principal': principalId
    },
    body: {
      name: 'Nile Foods Global',
      description: 'Enterprise FMCG Brand Client',
      status: 'ACTIVE'
    }
  });
  if (!clientRes.ok) {
    throw new Error(`Client creation failed (${clientRes.status}): ${JSON.stringify(clientRes.data)}`);
  }
  const client = clientRes.data;
  console.log('   Client created:', client.name, `(id: ${client.id}, revision: ${client.revision})`);

  // 10. Create Contact on Client
  console.log('9. Creating contact on client...');
  csrf = await getCsrfToken();
  const contactRes = await apiCall(`/organizations/${org.id}/clients/${client.id}/contacts`, {
    method: 'POST',
    headers: {
      'x-csrf-token': csrf,
      'x-organization-principal': principalId
    },
    body: {
      name: 'Layla Mansour',
      email: `layla.${timestamp.toString().slice(-4)}@nilefoods.com`,
      status: 'ACTIVE'
    }
  });
  if (!contactRes.ok) {
    throw new Error(`Contact creation failed (${contactRes.status}): ${JSON.stringify(contactRes.data)}`);
  }
  const contact = contactRes.data;
  console.log('   Contact created:', contact.name, `(id: ${contact.id})`);

  // 11. Create Project
  console.log('10. Creating project...');
  csrf = await getCsrfToken();
  const projectRes = await apiCall(`/organizations/${org.id}/projects`, {
    method: 'POST',
    headers: {
      'x-csrf-token': csrf,
      'x-organization-principal': principalId
    },
    body: {
      client_id: client.id,
      name: 'Brand Launch Campaign 2026',
      description: 'National launch campaign across digital and broadcast',
      due_at: null,
      portal_enabled: true,
      status: 'ACTIVE'
    }
  });
  if (!projectRes.ok) {
    throw new Error(`Project creation failed (${projectRes.status}): ${JSON.stringify(projectRes.data)}`);
  }
  const project = projectRes.data;
  console.log('   Project created:', project.name, `(id: ${project.id}, revision: ${project.revision})`);

  // 12. Create Milestone
  console.log('11. Creating milestone...');
  csrf = await getCsrfToken();
  const milestoneRes = await apiCall(`/organizations/${org.id}/projects/${project.id}/milestones`, {
    method: 'POST',
    headers: {
      'x-csrf-token': csrf,
      'x-organization-principal': principalId
    },
    body: {
      title: 'Rough Cut Delivery',
      due_at: null,
      position: 0,
      status: 'OPEN'
    }
  });
  if (!milestoneRes.ok) {
    throw new Error(`Milestone creation failed (${milestoneRes.status}): ${JSON.stringify(milestoneRes.data)}`);
  }
  const milestone = milestoneRes.data;
  console.log('   Milestone created:', milestone.title, `(id: ${milestone.id}, revision: ${milestone.revision})`);

  // 11b. Add principal to project members so they can be assigned tasks
  console.log('11b. Adding principal to project members...');
  csrf = await getCsrfToken();
  const memberRes = await apiCall(`/organizations/${org.id}/projects/${project.id}/members`, {
    method: 'POST',
    headers: {
      'x-csrf-token': csrf,
      'x-organization-principal': principalId
    },
    body: {
      membership_id: principalId,
      role: 'MANAGER',
      status: 'ACTIVE'
    }
  });
  const projectMemberId = memberRes.data.id;
  console.log('   Project member added (id:', projectMemberId, ')');

  // 12. Create Task with Checklist
  console.log('12. Creating task...');
  csrf = await getCsrfToken();
  const taskRes = await apiCall(`/organizations/${org.id}/projects/${project.id}/tasks`, {
    method: 'POST',
    headers: {
      'x-csrf-token': csrf,
      'x-organization-principal': principalId
    },
    body: {
      title: 'Color Grading & Audio Mastering',
      description: 'Perform HDR color pass and 5.1 audio master',
      milestone_id: milestone.id,
      assignee_id: projectMemberId,
      priority: 'HIGH',
      status: 'IN_PROGRESS',
      due_at: null,
      position: 0
    }
  });
  if (!taskRes.ok) {
    throw new Error(`Task creation failed (${taskRes.status}): ${JSON.stringify(taskRes.data)}`);
  }
  const task = taskRes.data;
  console.log('   Task created:', task.title, `(id: ${task.id}, revision: ${task.revision})`);

  console.log('13. Creating task checklist item...');
  csrf = await getCsrfToken();
  const checkRes = await apiCall(`/organizations/${org.id}/projects/${project.id}/tasks/${task.id}/checklist`, {
    method: 'POST',
    headers: {
      'x-csrf-token': csrf,
      'x-organization-principal': principalId
    },
    body: {
      label: 'Broadcast Loudness Check (-24 LKFS)',
      position: 0,
      completed: false
    }
  });
  if (!checkRes.ok) {
    throw new Error(`Checklist creation failed (${checkRes.status}): ${JSON.stringify(checkRes.data)}`);
  }
  const checklist = checkRes.data;
  console.log('   Checklist created:', checklist.label, `(id: ${checklist.id})`);

  // 14. Create Deliverable
  console.log('14. Creating deliverable...');
  csrf = await getCsrfToken();
  const delivRes = await apiCall(`/organizations/${org.id}/projects/${project.id}/deliverables`, {
    method: 'POST',
    headers: {
      'x-csrf-token': csrf,
      'x-organization-principal': principalId
    },
    body: {
      title: 'Commercial 60s Cut',
      description: 'Full broadcast master deliverable',
      task_id: task.id,
      status: 'ACTIVE'
    }
  });
  if (!delivRes.ok) {
    throw new Error(`Deliverable creation failed (${delivRes.status}): ${JSON.stringify(delivRes.data)}`);
  }
  const deliverable = delivRes.data;
  console.log('   Deliverable created:', deliverable.title, `(id: ${deliverable.id}, revision: ${deliverable.revision})`);

  // 15. Create Version on Deliverable (via file upload intent + finalize)
  console.log('15. Creating deliverable version via upload...');
  const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const pngDigest = crypto.createHash('sha256').update(pngBytes).digest('hex');

  csrf = await getCsrfToken();
  const uploadIntentRes = await apiCall(`/organizations/${org.id}/projects/${project.id}/uploads`, {
    method: 'POST',
    headers: {
      'x-csrf-token': csrf,
      'x-organization-principal': principalId
    },
    body: {
      name: 'commercial_master.png',
      purpose: 'DELIVERABLE',
      folder_id: null,
      size: pngBytes.length,
      digest: pngDigest,
      mime: 'image/png'
    }
  });
  if (!uploadIntentRes.ok) {
    throw new Error(`Upload intent failed (${uploadIntentRes.status}): ${JSON.stringify(uploadIntentRes.data)}`);
  }
  const uploadIntent = uploadIntentRes.data;
  console.log('   Upload intent created:', uploadIntent.id);

  // Upload bytes to staging storage using capability
  const cap = uploadIntent.capability;
  const putRes = await fetch(cap.url, {
    method: 'PUT',
    headers: {
      ...cap.headers,
      Origin: 'https://localhost:8443'
    },
    body: pngBytes
  });
  console.log(`   Staging PUT status: ${putRes.status}`);

  // Finalize upload with empty object body
  csrf = await getCsrfToken();
  const finalizeRes = await apiCall(`/organizations/${org.id}/projects/${project.id}/uploads/${uploadIntent.id}/finalize`, {
    method: 'POST',
    headers: {
      'x-csrf-token': csrf,
      'x-organization-principal': principalId
    },
    body: {}
  });
  console.log('   Upload finalize status:', finalizeRes.status);

  // Give worker a moment to process the upload into a file_asset
  console.log('   Waiting for worker to process asset...');
  let assetId = null;
  for (let a = 0; a < 15; a++) {
    await new Promise((r) => setTimeout(r, 600));
    const upCheck = await apiCall(`/organizations/${org.id}/projects/${project.id}/uploads/${uploadIntent.id}`, {
      headers: { 'x-organization-principal': principalId }
    });
    if (upCheck.data?.asset_id) {
      assetId = upCheck.data.asset_id;
      break;
    }
  }

  if (assetId) {
    console.log('   Asset ready:', assetId);
    csrf = await getCsrfToken();
    const verRes = await apiCall(`/organizations/${org.id}/projects/${project.id}/deliverables/${deliverable.id}/versions`, {
      method: 'POST',
      headers: {
        'x-csrf-token': csrf,
        'x-organization-principal': principalId
      },
      body: { asset_id: assetId }
    });
    if (verRes.ok) {
      console.log('   Version created:', verRes.data?.id, `(version_number: ${verRes.data?.version_number})`);
    } else {
      console.log('   Version creation result:', verRes.status, verRes.data);
    }
  } else {
    console.log('   (Asset processing deferred; worker queue may be backgrounded)');
  }

  // 16. Verification Checks (Required by Group 1):
  // Check A: Org-scoped GET with X-Organization-Principal
  console.log('\n--- VERIFICATION CHECKS ---');
  console.log('Check A: Running org-scoped GET with X-Organization-Principal...');
  const getProjectsRes = await apiCall(`/organizations/${org.id}/projects`, {
    method: 'GET',
    headers: { 'x-organization-principal': principalId }
  });
  if (!getProjectsRes.ok) {
    throw new Error(`Org-scoped GET failed (${getProjectsRes.status}): ${JSON.stringify(getProjectsRes.data)}`);
  }
  console.log('   [PASS] Org-scoped GET /projects succeeded. Found items:', getProjectsRes.data?.items?.length || 0);

  // Check B: Org-scoped mutation with If-Match
  console.log('Check B: Running org-scoped mutation with If-Match...');
  csrf = await getCsrfToken();
  const updateProjectRes = await apiCall(`/organizations/${org.id}/projects/${project.id}`, {
    method: 'PATCH',
    headers: {
      'x-csrf-token': csrf,
      'x-organization-principal': principalId,
      'if-match': `"${project.revision}"`
    },
    body: {
      client_id: client.id,
      name: 'Brand Launch Campaign 2026 (Verified)',
      description: 'Updated campaign description via verified If-Match mutation',
      due_at: null,
      portal_enabled: true,
      status: 'ACTIVE'
    }
  });
  if (!updateProjectRes.ok) {
    throw new Error(`Org-scoped mutation with If-Match failed (${updateProjectRes.status}): ${JSON.stringify(updateProjectRes.data)}`);
  }
  console.log('   [PASS] Org-scoped mutation succeeded. New revision:', updateProjectRes.data?.revision);

  // Check C: Stale revision rejection check (optimistic concurrency verification)
  console.log('Check C: Verifying stale revision yields 412 STALE_REVISION...');
  csrf = await getCsrfToken();
  const staleRes = await apiCall(`/organizations/${org.id}/projects/${project.id}`, {
    method: 'PATCH',
    headers: {
      'x-csrf-token': csrf,
      'x-organization-principal': principalId,
      'if-match': `"${project.revision}"` // Old revision before update
    },
    body: {
      client_id: client.id,
      name: 'Should Fail',
      description: 'Stale update attempt',
      due_at: null,
      portal_enabled: true,
      status: 'ACTIVE'
    }
  });
  if (staleRes.status === 412) {
    console.log('   [PASS] Stale revision correctly rejected with 412 STALE_REVISION.');
  } else {
    console.warn(`   [WARN] Unexpected response to stale revision: ${staleRes.status}`);
  }

  console.log('\n--- DEV SEED COMPLETE ---');
  console.log('Credentials and Identifiers:');
  console.log('  Email:            ', testEmail);
  console.log('  Password:         ', testPassword);
  console.log('  Organization ID:  ', org.id);
  console.log('  Principal ID:     ', principalId);
  console.log('  Client ID:        ', client.id);
  console.log('  Project ID:       ', project.id);
  console.log('  Milestone ID:     ', milestone.id);
  console.log('  Task ID:          ', task.id);
  console.log('  Deliverable ID:   ', deliverable.id);
}

main().catch((err) => {
  console.error('\nSeed error:', err);
  process.exit(1);
});
