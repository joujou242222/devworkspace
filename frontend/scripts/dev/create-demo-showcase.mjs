import crypto from 'node:crypto';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const API_BASE = 'http://127.0.0.1:3001/api/v1';
const MAILPIT_BASE = 'http://127.0.0.1:8025/api/v1';
const ORIGIN = 'https://localhost:8443';

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

  return { status: res.status, ok: res.ok, data, headers: res.headers };
}

async function getCsrfToken() {
  const res = await apiCall('/identity/csrf');
  return res.data.token;
}

async function main() {
  console.log('--- Seeding Demo Showcase Account ---');

  const demoEmail = 'demo@agency.com';
  const demoPassword = 'Password123!';
  const demoName = 'Alex Morgan';

  // Try logging in
  let csrf = await getCsrfToken();
  let loginRes = await apiCall('/identity/login', {
    method: 'POST',
    headers: { 'x-csrf-token': csrf },
    body: { email: demoEmail, password: demoPassword }
  });

  if (!loginRes.ok) {
    console.log('Registering fresh user...');
    csrf = await getCsrfToken();
    await apiCall('/identity/register', {
      method: 'POST',
      headers: { 'x-csrf-token': csrf },
      body: { name: demoName, email: demoEmail, password: demoPassword }
    });

    await new Promise((r) => setTimeout(r, 1000));
    const mailRes = await fetch(`${MAILPIT_BASE}/messages`);
    const mailData = await mailRes.json();
    const userMail = (mailData.messages || []).find(m => m.To && m.To.some(t => t.Address.toLowerCase() === demoEmail.toLowerCase()));
    const detailRes = await fetch(`${MAILPIT_BASE}/message/${userMail.ID}`);
    const detail = await detailRes.json();
    const match = /https?:\/\/[^\s]+/.exec(detail.Text || '');
    const verifyToken = new URL(match[0]).searchParams.get('token');

    csrf = await getCsrfToken();
    await apiCall('/identity/verify', {
      method: 'POST',
      headers: { 'x-csrf-token': csrf },
      body: { token: verifyToken }
    });

    csrf = await getCsrfToken();
    loginRes = await apiCall('/identity/login', {
      method: 'POST',
      headers: { 'x-csrf-token': csrf },
      body: { email: demoEmail, password: demoPassword }
    });
  }

  console.log('Login successful.');

  // Check if user already has an org
  let princRes = await apiCall('/me/principals');
  let principals = princRes.data?.items || [];
  let orgId = null;
  let principalId = null;

  if (principals.length === 0) {
    console.log('Creating organization for demo user...');
    csrf = await getCsrfToken();
    const orgRes = await apiCall('/organizations', {
      method: 'POST',
      headers: { 'x-csrf-token': csrf },
      body: {
        name: 'Apex Digital Studio',
        description: 'Brand Identity, Creative Direction & App Design',
        timezone: 'UTC'
      }
    });

    orgId = orgRes.data.organizationId || orgRes.data.id;

    // Re-authenticate due to backend session rotation
    csrf = await getCsrfToken();
    await apiCall('/identity/login', {
      method: 'POST',
      headers: { 'x-csrf-token': csrf },
      body: { email: demoEmail, password: demoPassword }
    });

    princRes = await apiCall('/me/principals');
    principals = princRes.data?.items || [];
  }

  const activePrincipal = principals[0];
  principalId = activePrincipal.id;
  orgId = activePrincipal.organizationId || activePrincipal.organization_id;
  console.log('Org ID:', orgId, 'Principal ID:', principalId);

  // Check existing clients
  const clientsRes = await apiCall(`/organizations/${orgId}/clients`, {
    headers: { 'x-organization-principal': principalId }
  });
  let client = (clientsRes.data?.items || clientsRes.data || [])[0];

  if (!client) {
    console.log('Creating client Acme Global...');
    csrf = await getCsrfToken();
    const newClientRes = await apiCall(`/organizations/${orgId}/clients`, {
      method: 'POST',
      headers: { 'x-csrf-token': csrf, 'x-organization-principal': principalId },
      body: {
        name: 'Acme Global Ventures',
        description: 'Global FinTech and payment solutions provider',
        status: 'ACTIVE'
      }
    });
    client = newClientRes.data;

    // Contact
    csrf = await getCsrfToken();
    await apiCall(`/organizations/${orgId}/clients/${client.id}/contacts`, {
      method: 'POST',
      headers: { 'x-csrf-token': csrf, 'x-organization-principal': principalId },
      body: {
        name: 'Sarah Jenkins',
        email: 'sarah.jenkins@acmeglobal.example',
        status: 'ACTIVE'
      }
    });
  }

  // Check existing projects
  const projsRes = await apiCall(`/organizations/${orgId}/projects`, {
    headers: { 'x-organization-principal': principalId }
  });
  let project = (projsRes.data?.items || projsRes.data || [])[0];

  if (!project) {
    console.log('Creating project OmniPay Design System...');
    csrf = await getCsrfToken();
    const newProjRes = await apiCall(`/organizations/${orgId}/projects`, {
      method: 'POST',
      headers: { 'x-csrf-token': csrf, 'x-organization-principal': principalId },
      body: {
        client_id: client.id,
        name: 'OmniPay Design System & Brand Identity',
        description: 'Complete visual identity, component library, and client review cycles.',
        due_at: '2026-12-15T18:00:00.000Z',
        portal_enabled: true,
        status: 'ACTIVE'
      }
    });
    project = newProjRes.data;

    // Add principal membership to project
    csrf = await getCsrfToken();
    const memRes = await apiCall(`/organizations/${orgId}/projects/${project.id}/members`, {
      method: 'POST',
      headers: { 'x-csrf-token': csrf, 'x-organization-principal': principalId },
      body: {
        membership_id: principalId,
        role: 'OWNER',
        status: 'ACTIVE'
      }
    });

    // Milestones
    csrf = await getCsrfToken();
    const ms1 = await apiCall(`/organizations/${orgId}/projects/${project.id}/milestones`, {
      method: 'POST',
      headers: { 'x-csrf-token': csrf, 'x-organization-principal': principalId },
      body: {
        title: 'Sprint 1: Brand Token Architecture',
        due_at: '2026-11-05T12:00:00.000Z',
        status: 'COMPLETED'
      }
    });

    csrf = await getCsrfToken();
    const ms2 = await apiCall(`/organizations/${orgId}/projects/${project.id}/milestones`, {
      method: 'POST',
      headers: { 'x-csrf-token': csrf, 'x-organization-principal': principalId },
      body: {
        title: 'Sprint 2: Proofly Review & Deliverables',
        due_at: '2026-11-20T18:00:00.000Z',
        status: 'OPEN'
      }
    });

    // Tasks
    csrf = await getCsrfToken();
    await apiCall(`/organizations/${orgId}/projects/${project.id}/tasks`, {
      method: 'POST',
      headers: { 'x-csrf-token': csrf, 'x-organization-principal': principalId },
      body: {
        title: 'Review typography scale & slate contrast',
        description: 'Ensure all heading scales align with WCAG AA compliance on dark backgrounds.',
        assignee_id: memRes.data?.id,
        milestone_id: ms2.data?.id,
        priority: 'HIGH',
        status: 'IN_PROGRESS',
        position: 1
      }
    });

    csrf = await getCsrfToken();
    await apiCall(`/organizations/${orgId}/projects/${project.id}/tasks`, {
      method: 'POST',
      headers: { 'x-csrf-token': csrf, 'x-organization-principal': principalId },
      body: {
        title: 'Export design guidelines PDF for client portal',
        description: 'High-res export with token reference tables.',
        assignee_id: memRes.data?.id,
        milestone_id: ms2.data?.id,
        priority: 'MEDIUM',
        status: 'TODO',
        position: 2
      }
    });

    csrf = await getCsrfToken();
    await apiCall(`/organizations/${orgId}/projects/${project.id}/tasks`, {
      method: 'POST',
      headers: { 'x-csrf-token': csrf, 'x-organization-principal': principalId },
      body: {
        title: 'Initial client stakeholder kick-off alignment',
        description: 'Agreed on scope and weekly review rhythms.',
        assignee_id: memRes.data?.id,
        milestone_id: ms1.data?.id,
        priority: 'LOW',
        status: 'DONE',
        position: 3
      }
    });

    // Document
    csrf = await getCsrfToken();
    await apiCall(`/organizations/${orgId}/documents`, {
      method: 'POST',
      headers: { 'x-csrf-token': csrf, 'x-organization-principal': principalId },
      body: {
        title: 'Apex Studio: 2026 Product Design Manifesto',
        content: JSON.stringify({
          type: 'doc',
          content: [
            { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Product Design Manifesto' }] },
            { type: 'paragraph', content: [{ type: 'text', text: 'This document defines the core principles, accessibility guidelines, and component standards across our product delivery monolith.' }] }
          ]
        })
      }
    });
  }

  console.log('========================================================');
  console.log('DEMO SHOWCASE READY FOR USER TO VIEW!');
  console.log('  App URL:    http://localhost:5199/login');
  console.log('  Email:      demo@agency.com');
  console.log('  Password:   Password123!');
  console.log('  Org:        Apex Digital Studio');
  console.log('  Client:     Acme Global Ventures');
  console.log('  Project:    OmniPay Design System & Brand Identity');
  console.log('========================================================');
}

main().catch(err => {
  console.error('Showcase setup failed:', err);
  process.exit(1);
});
