const BASE_URL = 'http://localhost:5199';
const MAILPIT_API = 'http://127.0.0.1:8025/api/v1';

async function waitForMail(recipientEmail, subjectSubstring = null, maxWaitMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await fetch(`${MAILPIT_API}/messages`);
    const data = await res.json();
    const msg = (data.messages || []).find(m =>
      m.To && m.To.some(t => t.Address.toLowerCase() === recipientEmail.toLowerCase()) &&
      (!subjectSubstring || (m.Subject && m.Subject.includes(subjectSubstring)))
    );
    if (msg) return msg;
    await new Promise(r => setTimeout(r, 500));
  }
  return null;
}

class SessionClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookies = new Map();
  }

  cookieHeader() {
    return Array.from(this.cookies, ([k, v]) => `${k}=${v}`).join('; ');
  }

  absorbCookies(res) {
    const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')];
    for (const line of raw || []) {
      if (!line) continue;
      const at = line.indexOf('=');
      if (at > 0) {
        this.cookies.set(line.slice(0, at).trim(), line.slice(at + 1).split(';')[0].trim());
      }
    }
  }

  async request(path, method = 'GET', body = undefined, headers = {}) {
    let csrfHeaders = {};
    if (method !== 'GET') {
      const csrfRes = await fetch(`${this.baseUrl}/api/v1/identity/csrf`, {
        headers: { Cookie: this.cookieHeader(), Origin: this.baseUrl }
      });
      this.absorbCookies(csrfRes);
      const csrfData = await csrfRes.json();
      csrfHeaders['x-csrf-token'] = csrfData.token;
    }

    const res = await fetch(`${this.baseUrl}${path.startsWith('/') ? path : '/' + path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Cookie: this.cookieHeader(),
        Origin: this.baseUrl,
        ...csrfHeaders,
        ...headers
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    this.absorbCookies(res);
    return res;
  }
}

async function registerAndLogin(client, email, name, password) {
  // 1. Register
  const regRes = await client.request('/api/v1/identity/register', 'POST', { email, name, password });
  if (regRes.status !== 202) throw new Error('Register failed: ' + (await regRes.text()));

  // 2. Verify
  const mail = await waitForMail(email, 'Verify');
  if (!mail) throw new Error('No verify mail for ' + email);
  const detail = await (await fetch(`${MAILPIT_API}/message/${mail.ID}`)).json();
  const token = new URL(/https?:\/\/[^\s]+/.exec(detail.Text)[0]).searchParams.get('token');
  const verifyRes = await client.request('/api/v1/identity/verify', 'POST', { token });
  if (!verifyRes.ok) throw new Error('Verify failed: ' + verifyRes.status);

  // 3. Login
  const loginRes = await client.request('/api/v1/identity/login', 'POST', { email, password });
  if (!loginRes.ok) throw new Error('Login failed: ' + loginRes.status);
}

async function main() {
  console.log('=== VERIFYING PORTAL_ENABLED API FLOW ===');
  const ts = Date.now();
  const ownerEmail = `portal.owner.${ts}@example.com`;
  const contactEmail = `portal.client.${ts}@example.com`;
  const pass = 'Password123!';

  const ownerClient = new SessionClient(BASE_URL);
  const contactClient = new SessionClient(BASE_URL);

  console.log('1. Registering agency owner and client user...');
  await registerAndLogin(ownerClient, ownerEmail, 'Agency Owner', pass);
  await registerAndLogin(contactClient, contactEmail, 'Client Contact User', pass);

  // 2. Create Organization as Owner
  console.log('2. Creating organization as owner...');
  const orgRes = await ownerClient.request('/api/v1/organizations', 'POST', {
    name: `Agency ${ts}`,
    description: 'Testing agency',
    timezone: 'UTC'
  }, { 'Idempotency-Key': `org-${ts}` });
  const orgData = await orgRes.json();
  const orgId = orgData.id || orgData.organizationId;

  // Re-login owner to establish organization principal
  await ownerClient.request('/api/v1/identity/login', 'POST', { email: ownerEmail, password: pass });

  // Get active principal
  const princRes = await ownerClient.request('/api/v1/me/principals');
  const princData = await princRes.json();
  const ownerPrincipalId = princData.items[0].id;
  const ownerHeaders = {
    'X-Organization-Principal': ownerPrincipalId
  };

  // 3. Create Client and Contact
  console.log('3. Creating Client and Contact...');
  const clientRes = await ownerClient.request(`/api/v1/organizations/${orgId}/clients`, 'POST', {
    name: 'Acme Portal Client',
    description: '',
    status: 'ACTIVE'
  }, ownerHeaders);
  const client = await clientRes.json();

  const contactRes = await ownerClient.request(`/api/v1/organizations/${orgId}/clients/${client.id}/contacts`, 'POST', {
    name: 'Jane Acme',
    email: contactEmail,
    status: 'ACTIVE'
  }, ownerHeaders);
  const contact = await contactRes.json();

  // 4. Create Project with portal_enabled: true
  console.log('4. Creating project with portal_enabled: true...');
  const projectRes = await ownerClient.request(`/api/v1/organizations/${orgId}/projects`, 'POST', {
    client_id: client.id,
    name: 'Portal Test Project',
    description: 'Testing portal visibility',
    due_at: '2026-12-15T12:00:00.000Z',
    portal_enabled: true,
    status: 'ACTIVE'
  }, ownerHeaders);
  const project = await projectRes.json();
  console.log('   Project created with portal_enabled:', project.portal_enabled);

  // 5. Send Client Invitation & Grant
  console.log('5. Sending client invitation for project...');
  const invRes = await ownerClient.request(`/api/v1/organizations/${orgId}/clients/${client.id}/contacts/${contact.id}/invitations`, 'POST', {
    project_id: project.id,
    role: 'REVIEWER'
  }, ownerHeaders);
  if (!invRes.ok) throw new Error('Failed to create client invite: ' + (await invRes.text()));

  // Get invitation email from Mailpit
  const clientMail = await waitForMail(contactEmail, 'invitation');
  if (!clientMail) throw new Error('No client invitation email received');
  const clientMailDetail = await (await fetch(`${MAILPIT_API}/message/${clientMail.ID}`)).json();
  const inviteToken = new URL(/https?:\/\/[^\s]+/.exec(clientMailDetail.Text)[0]).searchParams.get('token');

  // Accept invitation as contactClient
  console.log('6. Accepting client invitation as contact user...');
  const acceptRes = await contactClient.request('/api/v1/invitations/accept', 'POST', { token: inviteToken }, {
    'Idempotency-Key': `accept-${ts}`
  });
  console.log('   Invitation accept status:', acceptRes.status);

  // Re-login contactClient to refresh session principals
  await contactClient.request('/api/v1/identity/login', 'POST', { email: contactEmail, password: pass });

  // Get contact principal id
  const contactPrincRes = await contactClient.request('/api/v1/me/principals');
  const contactPrincData = await contactPrincRes.json();
  const clientPrincipal = contactPrincData.items.find(p => p.organization_id === orgId);
  console.log('   Client principal found:', clientPrincipal?.id, 'role:', clientPrincipal?.role);

  const contactHeaders = {
    'X-Organization-Principal': clientPrincipal?.id || contact.id
  };

  // 7. Call portal project list endpoint as that contact
  console.log('7. Calling portal project list endpoint (GET /organizations/{orgId}/portal) as contact...');
  const portalListRes = await contactClient.request(`/api/v1/organizations/${orgId}/portal`, 'GET', undefined, contactHeaders);
  const portalListStatus = portalListRes.status;
  const portalListData = await portalListRes.json();
  console.log('   GET /organizations/{orgId}/portal Status Code:', portalListStatus);
  console.log('   Portal projects count:', portalListData.items?.length);
  const hasProject = portalListData.items?.some(p => p.id === project.id);
  console.log('   Project present in portal project list:', hasProject);

  // 8. Call portal read endpoint (GET /organizations/{orgId}/portal/projects/{projectId}/reviews)
  console.log('8. Calling portal read endpoint (GET /organizations/{orgId}/portal/projects/{id}/reviews) as contact...');
  const portalReadRes = await contactClient.request(`/api/v1/organizations/${orgId}/portal/projects/${project.id}/reviews`, 'GET', undefined, contactHeaders);
  const portalReadStatus = portalReadRes.status;
  const portalReadData = await portalReadRes.json();
  console.log('   GET /organizations/{orgId}/portal/projects/{id}/reviews Status Code:', portalReadStatus);
  console.log('   Portal reviews count:', portalReadData.items?.length);

  if (portalListStatus === 200 && hasProject && portalReadStatus === 200) {
    console.log('\n[PASS] portal_enabled: true verified via API:');
    console.log(`- GET /organizations/${orgId}/portal: ${portalListStatus} OK (project included)`);
    console.log(`- GET /organizations/${orgId}/portal/projects/${project.id}/reviews: ${portalReadStatus} OK`);
  } else {
    throw new Error(`Portal verification failed: portalListStatus=${portalListStatus}, portalReadStatus=${portalReadStatus}`);
  }
}

main().catch(err => {
  console.error('\nFAILED PORTAL API VERIFICATION:', err);
  process.exit(1);
});
