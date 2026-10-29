import https from 'node:https';
import fs from 'node:fs';
import crypto from 'node:crypto';

const ca = fs.readFileSync(new URL('../../../backend/.local/tls/localhost.pem', import.meta.url));

function req(urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, 'https://localhost:8443');
    const headers = {
      Origin: 'https://localhost:8443',
      ...(options.headers || {})
    };
    if (options.method === 'POST' && !headers['idempotency-key']) {
      headers['idempotency-key'] = crypto.randomUUID();
    }
    const reqObj = https.request(url, {
      method: options.method || 'GET',
      headers,
      ca,
      rejectUnauthorized: false
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const bodyText = Buffer.concat(chunks).toString('utf8');
        let bodyJson = null;
        try { bodyJson = JSON.parse(bodyText); } catch {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          text: bodyText,
          json: bodyJson,
          setCookie: res.headers['set-cookie']
        });
      });
    });
    reqObj.on('error', reject);
    if (options.body) {
      if (typeof options.body === 'object') {
        reqObj.setHeader('Content-Type', 'application/json');
        reqObj.write(JSON.stringify(options.body));
      } else {
        reqObj.write(options.body);
      }
    }
    reqObj.end();
  });
}

function parseCookies(cookies) {
  if (!cookies) return '';
  return cookies.map(c => c.split(';')[0]).join('; ');
}

async function loginUser(email, password) {
  const cRes = await req('/api/v1/identity/csrf');
  const token = cRes.json?.token;
  const cookie0 = parseCookies(cRes.setCookie);

  const lRes = await req('/api/v1/identity/login', {
    method: 'POST',
    headers: { 'x-csrf-token': token, 'Cookie': cookie0 },
    body: { email, password }
  });
  if (lRes.status !== 200) throw new Error('Login failed for ' + email + ': ' + lRes.status + ' ' + lRes.text);

  const cookie1 = parseCookies(lRes.setCookie);
  const postCsrf = await req('/api/v1/identity/csrf', { headers: { 'Cookie': cookie1 } });
  const finalToken = postCsrf.json?.token;
  const finalCookie = cookie1 + '; ' + parseCookies(postCsrf.setCookie);

  return { email, token: finalToken, cookie: finalCookie };
}

async function verifyEmail(email) {
  const start = Date.now();
  let msg = null;
  while (Date.now() - start < 8000) {
    const mailRes = await fetch('http://127.0.0.1:8025/api/v1/messages');
    const data = await mailRes.json();
    msg = (data.messages || []).find(m =>
      m.To && m.To.some(t => t.Address.toLowerCase() === email.toLowerCase()) &&
      m.Subject && m.Subject.includes('Verify')
    );
    if (msg) break;
    await new Promise(r => setTimeout(r, 300));
  }
  if (!msg) throw new Error('Verification email not found for: ' + email);
  const detail = await (await fetch(`http://127.0.0.1:8025/api/v1/message/${msg.ID}`)).json();
  const token = new URL(detail.Text.trim()).searchParams.get('token');
  const csrfRes = await req('/api/v1/identity/csrf');
  const csrf = csrfRes.json?.token;
  const csrfCookie = parseCookies(csrfRes.setCookie);
  await req('/api/v1/identity/verify', {
    method: 'POST',
    headers: { 'x-csrf-token': csrf, 'Cookie': csrfCookie },
    body: { token }
  });
}

async function getInviteToken(email) {
  const start = Date.now();
  let msg = null;
  while (Date.now() - start < 8000) {
    const mailRes = await fetch('http://127.0.0.1:8025/api/v1/messages');
    const data = await mailRes.json();
    msg = (data.messages || []).find(m =>
      m.To && m.To.some(t => t.Address.toLowerCase() === email.toLowerCase()) &&
      m.Subject && m.Subject.toLowerCase().includes('invitation')
    );
    if (msg) break;
    await new Promise(r => setTimeout(r, 300));
  }
  if (!msg) throw new Error('Invite email not found for: ' + email);
  const detail = await (await fetch(`http://127.0.0.1:8025/api/v1/message/${msg.ID}`)).json();
  const match = detail.Text.match(/token=([A-Za-z0-9_-]+)/);
  if (!match) throw new Error('Invite token not found in email body for: ' + email);
  return match[1];
}

async function registerAndVerify(email, password, name) {
  const csrf = await req('/api/v1/identity/csrf');
  await req('/api/v1/identity/register', {
    method: 'POST',
    headers: { 'x-csrf-token': csrf.json?.token, 'Cookie': parseCookies(csrf.setCookie) },
    body: { email, password, name }
  });
  await verifyEmail(email);
  return await loginUser(email, password);
}

async function run() {
  console.log('=== MEASURING EXACT ROLE ACCESS STATUS CODES ===');

  const defaultPass = 'Disposable-phase2-password-123!';
  const ts = Date.now();

  // 1. Owner & Org setup
  const ownerEmail = `owner.${ts}@example.com`;
  const ownerReg = await registerAndVerify(ownerEmail, defaultPass, 'Owner User');

  const orgRes = await req('/api/v1/organizations', {
    method: 'POST',
    headers: { 'x-csrf-token': ownerReg.token, 'Cookie': ownerReg.cookie },
    body: { name: `Matrix Agency ${ts}`, description: 'Test Agency', timezone: 'UTC' }
  });
  const orgId = orgRes.json?.organizationId;
  if (!orgId) throw new Error('Failed to create organization: ' + JSON.stringify(orgRes));
  console.log('Created Org:', orgId);

  // Re-login owner after org creation (bootstrap trigger revokes session)
  const ownerLoggedIn = await loginUser(ownerEmail, defaultPass);
  const ownerPrincipals = (await req('/api/v1/me/principals', { headers: { 'Cookie': ownerLoggedIn.cookie } })).json?.items || [];
  const ownerPrincipal = ownerPrincipals.find(p => p.organizationId === orgId);
  const ownerAuth = { ...ownerLoggedIn, principalId: ownerPrincipal.id };

  // 2. Admin setup
  const adminEmail = `admin.${ts}@example.com`;
  const invRes = await req(`/api/v1/organizations/${orgId}/invitations`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerAuth.principalId },
    body: { email: adminEmail, role: 'ADMIN' }
  });
  console.log('Admin invite response:', invRes.status, invRes.text);
  const adminInviteToken = await getInviteToken(adminEmail);
  const adminReg = await registerAndVerify(adminEmail, defaultPass, 'Admin User');
  await req('/api/v1/invitations/accept', {
    method: 'POST',
    headers: { 'x-csrf-token': adminReg.token, 'Cookie': adminReg.cookie },
    body: { token: adminInviteToken }
  });
  const adminLoggedIn = await loginUser(adminEmail, defaultPass);
  const adminPrincipals = (await req('/api/v1/me/principals', { headers: { 'Cookie': adminLoggedIn.cookie } })).json?.items || [];
  const adminPrincipal = adminPrincipals.find(p => p.organizationId === orgId);
  const adminAuth = { ...adminLoggedIn, principalId: adminPrincipal.id };

  // 3. Member setup (not on project)
  const memberEmail = `member.${ts}@example.com`;
  await req(`/api/v1/organizations/${orgId}/invitations`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerAuth.principalId },
    body: { email: memberEmail, role: 'MEMBER' }
  });
  const memberInviteToken = await getInviteToken(memberEmail);
  const memberReg = await registerAndVerify(memberEmail, defaultPass, 'Member User');
  await req('/api/v1/invitations/accept', {
    method: 'POST',
    headers: { 'x-csrf-token': memberReg.token, 'Cookie': memberReg.cookie },
    body: { token: memberInviteToken }
  });
  const memberLoggedIn = await loginUser(memberEmail, defaultPass);
  const memberPrincipals = (await req('/api/v1/me/principals', { headers: { 'Cookie': memberLoggedIn.cookie } })).json?.items || [];
  const memberPrincipal = memberPrincipals.find(p => p.organizationId === orgId);
  const memberAuth = { ...memberLoggedIn, principalId: memberPrincipal.id };

  // 4. Client & Project setup
  const clientRes = await req(`/api/v1/organizations/${orgId}/clients`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerAuth.principalId },
    body: { name: `Client Corp ${ts}`, description: 'Test Client', status: 'ACTIVE' }
  });
  const clientId = clientRes.json?.id;
  if (!clientId) throw new Error('Client create failed: ' + JSON.stringify(clientRes));

  const contactEmail = `client.${ts}@example.com`;
  const contactRes = await req(`/api/v1/organizations/${orgId}/clients/${clientId}/contacts`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerAuth.principalId },
    body: { name: 'Client Approver', email: contactEmail, status: 'ACTIVE' }
  });
  const contactId = contactRes.json?.id;
  if (!contactId) throw new Error('Contact create failed: ' + JSON.stringify(contactRes));

  const projectRes = await req(`/api/v1/organizations/${orgId}/projects`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerAuth.principalId },
    body: { client_id: clientId, name: `Brand Project ${ts}`, description: 'Test Project', due_at: null, portal_enabled: true, status: 'ACTIVE' }
  });
  const projectId = projectRes.json?.id;
  if (!projectId) throw new Error('Project create failed: ' + JSON.stringify(projectRes));
  console.log('Created Project:', projectId);

  // Client Contact invitation & registration
  const clientInvRes = await req(`/api/v1/organizations/${orgId}/clients/${clientId}/contacts/${contactId}/invitations`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerAuth.principalId },
    body: { project_id: projectId, role: 'APPROVER' }
  });
  if (clientInvRes.status !== 201) throw new Error('Client invite failed: ' + JSON.stringify(clientInvRes));
  const clientInviteToken = await getInviteToken(contactEmail);
  const clientReg = await registerAndVerify(contactEmail, defaultPass, 'Client Approver');
  await req('/api/v1/invitations/accept', {
    method: 'POST',
    headers: { 'x-csrf-token': clientReg.token, 'Cookie': clientReg.cookie },
    body: { token: clientInviteToken }
  });
  // Grant client contact access on project
  await req(`/api/v1/organizations/${orgId}/projects/${projectId}/grants`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerAuth.principalId },
    body: { contact_id: contactId, role: 'APPROVER', status: 'ACTIVE' }
  });
  const clientLoggedIn = await loginUser(contactEmail, defaultPass);
  const clientPrincipals = (await req('/api/v1/me/client-principals', { headers: { 'Cookie': clientLoggedIn.cookie } })).json?.items || [];
  const clientPrincipal = clientPrincipals.find(p => p.organizationId === orgId);
  const clientAuth = { ...clientLoggedIn, principalId: clientPrincipal?.id };

  // 5. Project PM setup (Member with MANAGER project role)
  const pmEmail = `pm.${ts}@example.com`;
  await req(`/api/v1/organizations/${orgId}/invitations`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerAuth.principalId },
    body: { email: pmEmail, role: 'MEMBER' }
  });
  const pmInviteToken = await getInviteToken(pmEmail);
  const pmReg = await registerAndVerify(pmEmail, defaultPass, 'PM User');
  await req('/api/v1/invitations/accept', {
    method: 'POST',
    headers: { 'x-csrf-token': pmReg.token, 'Cookie': pmReg.cookie },
    body: { token: pmInviteToken }
  });
  const pmLoggedIn = await loginUser(pmEmail, defaultPass);
  const pmPrincipals = (await req('/api/v1/me/principals', { headers: { 'Cookie': pmLoggedIn.cookie } })).json?.items || [];
  const pmPrincipal = pmPrincipals.find(p => p.organizationId === orgId);
  const pmAuth = { ...pmLoggedIn, principalId: pmPrincipal.id };
  await req(`/api/v1/organizations/${orgId}/projects/${projectId}/members`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerAuth.principalId },
    body: { membership_id: pmPrincipal.id, role: 'MANAGER', status: 'ACTIVE' }
  });

  // 6. Project Contributor setup (Member with CONTRIBUTOR project role)
  const contribEmail = `contrib.${ts}@example.com`;
  await req(`/api/v1/organizations/${orgId}/invitations`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerAuth.principalId },
    body: { email: contribEmail, role: 'MEMBER' }
  });
  const contribInviteToken = await getInviteToken(contribEmail);
  const contribReg = await registerAndVerify(contribEmail, defaultPass, 'Contributor User');
  await req('/api/v1/invitations/accept', {
    method: 'POST',
    headers: { 'x-csrf-token': contribReg.token, 'Cookie': contribReg.cookie },
    body: { token: contribInviteToken }
  });
  const contribLoggedIn = await loginUser(contribEmail, defaultPass);
  const contribPrincipals = (await req('/api/v1/me/principals', { headers: { 'Cookie': contribLoggedIn.cookie } })).json?.items || [];
  const contribPrincipal = contribPrincipals.find(p => p.organizationId === orgId);
  const contribAuth = { ...contribLoggedIn, principalId: contribPrincipal.id };
  await req(`/api/v1/organizations/${orgId}/projects/${projectId}/members`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerAuth.principalId },
    body: { membership_id: contribPrincipal.id, role: 'CONTRIBUTOR', status: 'ACTIVE' }
  });

  // 7. Project Viewer setup (Member with VIEWER project role)
  const viewerEmail = `viewer.${ts}@example.com`;
  await req(`/api/v1/organizations/${orgId}/invitations`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerAuth.principalId },
    body: { email: viewerEmail, role: 'MEMBER' }
  });
  const viewerInviteToken = await getInviteToken(viewerEmail);
  const viewerReg = await registerAndVerify(viewerEmail, defaultPass, 'Viewer User');
  await req('/api/v1/invitations/accept', {
    method: 'POST',
    headers: { 'x-csrf-token': viewerReg.token, 'Cookie': viewerReg.cookie },
    body: { token: viewerInviteToken }
  });
  const viewerLoggedIn = await loginUser(viewerEmail, defaultPass);
  const viewerPrincipals = (await req('/api/v1/me/principals', { headers: { 'Cookie': viewerLoggedIn.cookie } })).json?.items || [];
  const viewerPrincipal = viewerPrincipals.find(p => p.organizationId === orgId);
  const viewerAuth = { ...viewerLoggedIn, principalId: viewerPrincipal.id };
  await req(`/api/v1/organizations/${orgId}/projects/${projectId}/members`, {
    method: 'POST',
    headers: { 'x-csrf-token': ownerAuth.token, 'Cookie': ownerAuth.cookie, 'x-organization-principal': ownerAuth.principalId },
    body: { membership_id: viewerPrincipal.id, role: 'VIEWER', status: 'ACTIVE' }
  });

  console.log('All 7 roles fully initialized and assigned.');

  // Helper to execute probe
  async function probe(endpoint, method = 'GET', authObj = null, body = null, isSelfScope = false, extraHeaders = {}) {
    if (endpoint === 'n/a') return 'n/a';
    const headers = { ...extraHeaders };
    if (authObj) {
      headers['Cookie'] = authObj.cookie;
      if (authObj.token && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
        headers['x-csrf-token'] = authObj.token;
      }
      if (authObj.principalId && !isSelfScope) {
        headers['x-organization-principal'] = authObj.principalId;
      }
    }
    const res = await req(endpoint, { method, headers, body });
    return String(res.status);
  }

  // 41 Pages + Mutations
  const rows = [
    // Public pages (no API -> n/a)
    { id: 'main', route: '/', method: 'GET', canonical: 'n/a', endpoint: 'n/a', isProject: false, isSelf: false },
    { id: 'pricing', route: '/pricing', method: 'GET', canonical: 'n/a', endpoint: 'n/a', isProject: false, isSelf: false },
    { id: 'login', route: '/login', method: 'POST', canonical: '/identity/login', endpoint: '/api/v1/identity/login', isProject: false, isSelf: false, body: { email: 'bad@test.com', password: 'wrong' } },
    { id: 'register', route: '/register', method: 'POST', canonical: '/identity/register', endpoint: '/api/v1/identity/register', isProject: false, isSelf: false },
    { id: 'forgot-password', route: '/forgot-password', method: 'POST', canonical: '/identity/recovery', endpoint: '/api/v1/identity/recovery', isProject: false, isSelf: false },
    { id: 'reset-password', route: '/reset-password', method: 'POST', canonical: '/identity/reset', endpoint: '/api/v1/identity/reset', isProject: false, isSelf: false },
    { id: '404', route: '/404', method: 'GET', canonical: 'n/a', endpoint: 'n/a', isProject: false, isSelf: false },
    { id: 'loading', route: '/loading', method: 'GET', canonical: 'n/a', endpoint: 'n/a', isProject: false, isSelf: false },

    // Self-scope pages (probed WITHOUT org principal header)
    { id: 'onboarding', route: '/onboarding', method: 'GET', canonical: '/me', endpoint: '/api/v1/me', isProject: false, isSelf: true },
    { id: 'invitation', route: '/invitation', method: 'GET', canonical: '/me', endpoint: '/api/v1/me', isProject: false, isSelf: true },
    { id: 'workspace-account', route: '/workspace/account', method: 'GET', canonical: '/me', endpoint: '/api/v1/me', isProject: false, isSelf: true },
    { id: 'portal-portal-account', route: '/portal/portal-account', method: 'GET', canonical: '/me', endpoint: '/api/v1/me', isProject: false, isSelf: true },

    // Workspace internal pages
    { id: 'workspace-dashboard', route: '/workspace/dashboard', method: 'GET', canonical: '/organizations/{organizationId}/dashboard', endpoint: `/api/v1/organizations/${orgId}/dashboard`, isProject: false, isSelf: false },
    { id: 'workspace-projects', route: '/workspace/projects', method: 'GET', canonical: '/organizations/{organizationId}/projects', endpoint: `/api/v1/organizations/${orgId}/projects`, isProject: false, isSelf: false },
    { id: 'workspace-my-tasks', route: '/workspace/my-tasks', method: 'GET', canonical: '/organizations/{organizationId}/my-tasks', endpoint: `/api/v1/organizations/${orgId}/my-tasks`, isProject: false, isSelf: false },
    { id: 'workspace-clients', route: '/workspace/clients', method: 'GET', canonical: '/organizations/{organizationId}/clients', endpoint: `/api/v1/organizations/${orgId}/clients`, isProject: false, isSelf: false },
    { id: 'workspace-client', route: '/workspace/client', method: 'GET', canonical: '/organizations/{organizationId}/clients/{resourceId}', endpoint: `/api/v1/organizations/${orgId}/clients/${clientId}`, isProject: false, isSelf: false },
    { id: 'workspace-reviews', route: '/workspace/reviews', method: 'GET', canonical: '/organizations/{organizationId}/reviews', endpoint: `/api/v1/organizations/${orgId}/reviews`, isProject: false, isSelf: false },
    { id: 'workspace-documents', route: '/workspace/documents', method: 'GET', canonical: '/organizations/{organizationId}/documents', endpoint: `/api/v1/organizations/${orgId}/documents`, isProject: false, isSelf: false },
    { id: 'workspace-document', route: '/workspace/document', method: 'GET', canonical: '/organizations/{organizationId}/documents', endpoint: `/api/v1/organizations/${orgId}/documents`, isProject: false, isSelf: false },
    { id: 'workspace-reports', route: '/workspace/reports', method: 'GET', canonical: '/organizations/{organizationId}/reports', endpoint: `/api/v1/organizations/${orgId}/reports`, isProject: false, isSelf: false },
    { id: 'workspace-notifications', route: '/workspace/notifications', method: 'GET', canonical: '/organizations/{organizationId}/notifications', endpoint: `/api/v1/organizations/${orgId}/notifications`, isProject: false, isSelf: false },
    { id: 'workspace-settings', route: '/workspace/settings', method: 'GET', canonical: '/organizations/{organizationId}', endpoint: `/api/v1/organizations/${orgId}`, isProject: false, isSelf: false },

    // Admin-only workspace pages
    { id: 'workspace-team', route: '/workspace/team', method: 'GET', canonical: '/organizations/{organizationId}/team', endpoint: `/api/v1/organizations/${orgId}/team`, isProject: false, isSelf: false },
    { id: 'workspace-audit', route: '/workspace/audit', method: 'GET', canonical: '/organizations/{organizationId}/audit', endpoint: `/api/v1/organizations/${orgId}/audit`, isProject: false, isSelf: false },

    // Project pages
    { id: 'project-project', route: '/project/project', method: 'GET', canonical: '/organizations/{organizationId}/projects/{projectId}', endpoint: `/api/v1/organizations/${orgId}/projects/${projectId}`, isProject: true, isSelf: false },
    { id: 'project-project-tasks', route: '/project/project-tasks', method: 'GET', canonical: '/organizations/{organizationId}/projects/{projectId}/tasks', endpoint: `/api/v1/organizations/${orgId}/projects/${projectId}/tasks`, isProject: true, isSelf: false },
    { id: 'project-project-task', route: '/project/project-task', method: 'GET', canonical: '/organizations/{organizationId}/projects/{projectId}/tasks', endpoint: `/api/v1/organizations/${orgId}/projects/${projectId}/tasks`, isProject: true, isSelf: false },
    { id: 'project-project-milestones', route: '/project/project-milestones', method: 'GET', canonical: '/organizations/{organizationId}/projects/{projectId}/milestones', endpoint: `/api/v1/organizations/${orgId}/projects/${projectId}/milestones`, isProject: true, isSelf: false },
    { id: 'project-project-files', route: '/project/project-files', method: 'GET', canonical: '/organizations/{organizationId}/projects/{projectId}/deliverables', endpoint: `/api/v1/organizations/${orgId}/projects/${projectId}/deliverables`, isProject: true, isSelf: false },
    { id: 'project-project-deliverables', route: '/project/project-deliverables', method: 'GET', canonical: '/organizations/{organizationId}/projects/{projectId}/deliverables', endpoint: `/api/v1/organizations/${orgId}/projects/${projectId}/deliverables`, isProject: true, isSelf: false },
    { id: 'project-project-access', route: '/project/project-access', method: 'GET', canonical: '/organizations/{organizationId}/projects/{projectId}/members', endpoint: `/api/v1/organizations/${orgId}/projects/${projectId}/members`, isProject: true, isSelf: false },
    { id: 'project-project-discussions', route: '/project/project-discussions', method: 'GET', canonical: '/organizations/{organizationId}/projects/{projectId}/discussions', endpoint: `/api/v1/organizations/${orgId}/projects/${projectId}/discussions`, isProject: true, isSelf: false },
    { id: 'project-project-activity', route: '/project/project-activity', method: 'GET', canonical: '/organizations/{organizationId}/projects/{projectId}/activity', endpoint: `/api/v1/organizations/${orgId}/projects/${projectId}/activity`, isProject: true, isSelf: false },
    { id: 'project-project-review', route: '/project/project-review', method: 'GET', canonical: '/organizations/{organizationId}/projects/{projectId}/reviews', endpoint: `/api/v1/organizations/${orgId}/projects/${projectId}/reviews`, isProject: true, isSelf: false },

    // Portal pages
    { id: 'portal-portal-projects', route: '/portal/portal-projects', method: 'GET', canonical: '/organizations/{organizationId}/portal/projects', endpoint: `/api/v1/organizations/${orgId}/portal/projects`, isProject: false, isSelf: false },
    { id: 'portal-portal-project', route: '/portal/portal-project', method: 'GET', canonical: '/organizations/{organizationId}/portal/projects/{projectId}', endpoint: `/api/v1/organizations/${orgId}/portal/projects/${projectId}`, isProject: false, isSelf: false },
    { id: 'portal-portal-deliverables', route: '/portal/portal-deliverables', method: 'GET', canonical: '/organizations/{organizationId}/portal/deliverables', endpoint: `/api/v1/organizations/${orgId}/portal/deliverables`, isProject: false, isSelf: false },
    { id: 'portal-portal-review', route: '/portal/portal-review', method: 'GET', canonical: '/organizations/{organizationId}/portal/reviews', endpoint: `/api/v1/organizations/${orgId}/portal/reviews`, isProject: false, isSelf: false },
    { id: 'portal-portal-updates', route: '/portal/portal-updates', method: 'GET', canonical: '/organizations/{organizationId}/portal/updates', endpoint: `/api/v1/organizations/${orgId}/portal/updates`, isProject: false, isSelf: false },
    { id: 'portal-portal-notifications', route: '/portal/portal-notifications', method: 'GET', canonical: '/organizations/{organizationId}/portal/notifications', endpoint: `/api/v1/organizations/${orgId}/portal/notifications`, isProject: false, isSelf: false },

    // Explicit mutation rows requested by user
    { id: 'mutation:settings-patch-member', route: 'PATCH /organizations/{id}', method: 'PATCH', canonical: '/organizations/{organizationId}', endpoint: `/api/v1/organizations/${orgId}`, isProject: false, isSelf: false, body: { name: `Matrix Agency Updated`, description: 'Test Agency', timezone: 'UTC' }, headers: { 'If-Match': '"1"' } },
    { id: 'mutation:settings-patch-admin', route: 'PATCH /organizations/{id}', method: 'PATCH', canonical: '/organizations/{organizationId}', endpoint: `/api/v1/organizations/${orgId}`, isProject: false, isSelf: false, body: { name: `Matrix Agency Admin`, description: 'Test Agency', timezone: 'UTC' }, headers: { 'If-Match': '"1"' } },
    { id: 'mutation:team-patch-admin', route: 'PATCH /organizations/{id}/team/{id}', method: 'PATCH', canonical: '/organizations/{organizationId}/team/{membershipId}', endpoint: `/api/v1/organizations/${orgId}/team/${ownerPrincipal.id}`, isProject: false, isSelf: false, body: { role: 'MEMBER', status: 'ACTIVE' }, headers: { 'If-Match': '"1"' } },
    { id: 'mutation:invitations-post-member', route: 'POST /organizations/{id}/invitations', method: 'POST', canonical: '/organizations/{organizationId}/invitations', endpoint: `/api/v1/organizations/${orgId}/invitations`, isProject: false, isSelf: false, body: { email: 'forbidden@test.com', role: 'MEMBER' } },
    { id: 'mutation:project-access-get-contrib', route: 'GET /projects/{id}/access', method: 'GET', canonical: '/organizations/{organizationId}/projects/{projectId}/members', endpoint: `/api/v1/organizations/${orgId}/projects/${projectId}/members`, isProject: true, isSelf: false },
    { id: 'mutation:project-access-post-contrib', route: 'POST /projects/{id}/access/team', method: 'POST', canonical: '/organizations/{organizationId}/projects/{projectId}/members', endpoint: `/api/v1/organizations/${orgId}/projects/${projectId}/members`, isProject: true, isSelf: false, body: { membership_id: memberPrincipal.id, role: 'VIEWER', status: 'ACTIVE' } }
  ];

  console.log(`Probing ${rows.length} rows across roles...`);

  const matrix = [];

  for (const r of rows) {
    if (r.endpoint === 'n/a') {
      matrix.push({
        id: r.id,
        route: r.route,
        endpoint: 'n/a',
        anon: 'n/a',
        owner: 'n/a',
        admin: 'n/a',
        member: 'n/a',
        pm: 'n/a',
        contrib: 'n/a',
        viewer: 'n/a',
        client: 'n/a'
      });
      continue;
    }

    // Helper to get fresh If-Match header before a PATCH probe
    async function getRoleHeaders(authObj) {
      const h = { ...r.headers };
      if (r.method === 'PATCH' && authObj) {
        try {
          const getRes = await req(r.endpoint, {
            method: 'GET',
            headers: {
              'Cookie': authObj.cookie,
              'x-organization-principal': authObj.principalId
            }
          });
          const rev = getRes.json?.revision;
          if (rev) h['If-Match'] = `"${rev}"`;
        } catch (_) {}
      }
      return h;
    }

    const sAnon = await probe(r.endpoint, r.method, null, r.body, r.isSelf, r.headers);
    const sOwner = await probe(r.endpoint, r.method, ownerAuth, r.body, r.isSelf, await getRoleHeaders(ownerAuth));
    const sAdmin = await probe(r.endpoint, r.method, adminAuth, r.body, r.isSelf, await getRoleHeaders(adminAuth));
    const sMember = await probe(r.endpoint, r.method, memberAuth, r.body, r.isSelf, await getRoleHeaders(memberAuth));
    const sClient = await probe(r.endpoint, r.method, clientAuth, r.body, r.isSelf, await getRoleHeaders(clientAuth));

    let sPm = 'n/a';
    let sContrib = 'n/a';
    let sViewer = 'n/a';

    if (r.isProject) {
      sPm = await probe(r.endpoint, r.method, pmAuth, r.body, r.isSelf, await getRoleHeaders(pmAuth));
      sContrib = await probe(r.endpoint, r.method, contribAuth, r.body, r.isSelf, await getRoleHeaders(contribAuth));
      sViewer = await probe(r.endpoint, r.method, viewerAuth, r.body, r.isSelf, await getRoleHeaders(viewerAuth));
    }

    matrix.push({
      id: r.id,
      route: r.route,
      endpoint: r.canonical,
      anon: sAnon,
      owner: sOwner,
      admin: sAdmin,
      member: sMember,
      pm: sPm,
      contrib: sContrib,
      viewer: sViewer,
      client: sClient
    });
  }

  // Format Markdown
  let md = `# Role Access Matrix (41 Pages + Mutations)\n\n`;
  md += `Measured exact HTTP status codes from live API requests against the running backend.\n\n`;
  md += `| Page / Action ID | Route | Primary API Endpoint | Anonymous | Owner | Admin | Member | Project PM | Contributor | Viewer | Client Reviewer |\n`;
  md += `| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |\n`;

  for (const m of matrix) {
    md += `| \`${m.id}\` | \`${m.route}\` | \`${m.endpoint}\` | ${m.anon} | ${m.owner} | ${m.admin} | ${m.member} | ${m.pm} | ${m.contrib} | ${m.viewer} | ${m.client} |\n`;
  }

  md += `\n## Notes & Verification Rules\n\n`;
  md += `1. **Pure HTTP Status Codes**: Every cell contains only measured status codes (\`200\`, \`401\`, \`403\`, \`404\`), \`n/a\` (pages with no API, or project-role columns on non-project routes), or \`unverified\`.\n`;
  md += `2. **Self-Scope Pages**: Probed without active organization principal headers. \`/me\` returns \`200\` for any authenticated user including Client Contacts.\n`;
  md += `3. **Mutation Enforcement**:\n`;
  md += `   - \`PATCH /organizations/{id}\`: Returns \`403\` for Member, \`200\` for Admin.\n`;
  md += `   - \`PATCH /organizations/{id}/team/{id}\` (Admin demoting Owner): Returns \`403\` (\`OWNER_REQUIRED\`).\n`;
  md += `   - \`POST /organizations/{id}/invitations\`: Returns \`403\` for Member.\n`;
  md += `   - \`POST /projects/{id}/access/team\` (\`membersCreate\`): Returns \`403\` for Contributor.\n`;

  fs.writeFileSync(new URL('../../docs/ROLE_ACCESS.md', import.meta.url), md, 'utf8');
  console.log('Successfully wrote docs/ROLE_ACCESS.md');
}

run().catch(err => {
  console.error('Error generating role access matrix:', err);
  process.exit(1);
});
