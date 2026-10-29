/**
 * Production & Demo Database Seed Script for DevWorkspace
 * 
 * Pre-populates:
 *   1. Demo Account: demo@agency.com / Password123!
 *   2. Agency Organization: "Studio Velocity"
 *   3. 3 Active Clients: Nile Beverages, Apex Retail, Zenith Labs
 *   4. 3 Realistic Projects with Milestones, Tasks, Checklists, and Deliverables
 * 
 * Works against both local dev and live deployed instances (via API or DATABASE_URL).
 */

import crypto from 'node:crypto';

const API_BASE = (process.env.API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '') + '/api/v1';
const ORIGIN = process.env.APP_ORIGIN || 'https://localhost:8443';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

let cookies = {};

function getCookieHeader() {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

function parseCookies(res) {
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const str of setCookie) {
    const parts = str.split(';')[0].split('=');
    const name = parts[0].trim();
    const val = parts.slice(1).join('=').trim();
    if (name) cookies[name] = val;
  }
}

async function apiCall(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});
  headers.set('origin', ORIGIN);

  const cookieHeader = getCookieHeader();
  if (cookieHeader) headers.set('cookie', cookieHeader);

  if (method === 'POST' && !headers.has('Idempotency-Key') && options.idempotencyKey !== false) {
    headers.set('Idempotency-Key', crypto.randomUUID());
  }

  let body = options.body;
  if (body && typeof body === 'object') {
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
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

export async function seedDemoData() {
  console.log('=== SEEDING PRODUCTION DEMO DATA ===');
  console.log(`Target API: ${API_BASE}`);

  const demoEmail = 'demo@agency.com';
  const demoPassword = 'Password123!';
  const demoName = 'Demo Agency Owner';

  // 1. Try to login directly
  let csrf = await getCsrfToken();
  let loginRes = await apiCall('/identity/login', {
    method: 'POST',
    headers: { 'x-csrf-token': csrf },
    body: { email: demoEmail, password: demoPassword }
  });

  if (!loginRes.ok) {
    console.log(`Demo user ${demoEmail} not found or unverified. Creating...`);
    csrf = await getCsrfToken();
    const regRes = await apiCall('/identity/register', {
      method: 'POST',
      headers: { 'x-csrf-token': csrf },
      body: { name: demoName, email: demoEmail, password: demoPassword }
    });

    if (!regRes.ok) {
      console.log('Registration response:', regRes.status, regRes.data);
    }

    // If database connection string is available, automatically verify email
    if (process.env.DATABASE_URL) {
      try {
        const { Pool } = await import('pg');
        const pool = new Pool({ connectionString: process.env.DATABASE_URL });
        await pool.query('UPDATE public.user SET email_verified = true WHERE email = $1', [demoEmail]);
        await pool.end();
        console.log(`Verified ${demoEmail} directly in PostgreSQL.`);
      } catch (dbErr) {
        console.warn('Direct DB email verification note:', dbErr.message);
      }
    }

    // Try login again
    csrf = await getCsrfToken();
    loginRes = await apiCall('/identity/login', {
      method: 'POST',
      headers: { 'x-csrf-token': csrf },
      body: { email: demoEmail, password: demoPassword }
    });
  }

  if (!loginRes.ok) {
    console.warn('Could not establish session for demo account:', loginRes.status, loginRes.data);
    return;
  }

  console.log('Session established for demo account:', demoEmail);

  // Check existing principals
  let princRes = await apiCall('/me/principals');
  let principals = princRes.data?.items || [];
  let orgId, principalId;

  if (principals.length === 0) {
    console.log('Creating initial organization "Studio Velocity"...');
    csrf = await getCsrfToken();
    const orgRes = await apiCall('/organizations', {
      method: 'POST',
      headers: { 'x-csrf-token': csrf },
      body: {
        name: 'Studio Velocity',
        description: 'Digital Delivery & Creative Production Agency',
        timezone: 'UTC'
      }
    });

    if (orgRes.ok) {
      orgId = orgRes.data.organizationId || orgRes.data.id;
      // Re-login after org creation
      csrf = await getCsrfToken();
      await apiCall('/identity/login', {
        method: 'POST',
        headers: { 'x-csrf-token': csrf },
        body: { email: demoEmail, password: demoPassword }
      });
      princRes = await apiCall('/me/principals');
      principals = princRes.data?.items || [];
    }
  }

  if (principals.length > 0) {
    orgId = principals[0].organizationId || principals[0].organization_id;
    principalId = principals[0].id;
    console.log(`Using active organization ID: ${orgId}, Principal ID: ${principalId}`);
  } else {
    console.warn('No active organization found; skipping child entity seeding.');
    return;
  }

  // Check if clients already exist
  const clientsRes = await apiCall(`/organizations/${orgId}/clients?limit=10`, {
    headers: { 'x-organization-principal': principalId }
  });
  const existingClients = clientsRes.data?.items || [];

  if (existingClients.length === 0) {
    console.log('Seeding demo clients, projects, and tasks...');
    const clientDefs = [
      { name: 'Nile Beverages', description: 'FMCG & Soft Drinks Brand' },
      { name: 'Apex Retail', description: 'Omnichannel Fashion & Retail Chain' },
      { name: 'Zenith Labs', description: 'Biotech & Health Innovations' }
    ];

    for (const cDef of clientDefs) {
      csrf = await getCsrfToken();
      const cRes = await apiCall(`/organizations/${orgId}/clients`, {
        method: 'POST',
        headers: {
          'x-csrf-token': csrf,
          'x-organization-principal': principalId
        },
        body: { name: cDef.name, description: cDef.description, status: 'ACTIVE' }
      });

      if (cRes.ok) {
        const c = cRes.data;
        console.log(`  + Created client: ${c.name}`);

        // Create Project for this client
        csrf = await getCsrfToken();
        const pRes = await apiCall(`/organizations/${orgId}/projects`, {
          method: 'POST',
          headers: {
            'x-csrf-token': csrf,
            'x-organization-principal': principalId
          },
          body: {
            client_id: c.id,
            name: c.name === 'Nile Beverages' ? 'Summer Campaign Film' : (c.name === 'Apex Retail' ? 'Brand Identity Redesign' : 'Mobile Showcase 2026'),
            description: `Full deliverables, media assets, and creative review for ${c.name}`,
            portal_enabled: true,
            status: 'ACTIVE'
          }
        });

        if (pRes.ok) {
          const proj = pRes.data;
          console.log(`    + Created project: ${proj.name}`);

          // Add member
          csrf = await getCsrfToken();
          const memRes = await apiCall(`/organizations/${orgId}/projects/${proj.id}/members`, {
            method: 'POST',
            headers: {
              'x-csrf-token': csrf,
              'x-organization-principal': principalId
            },
            body: { membership_id: principalId, role: 'MANAGER', status: 'ACTIVE' }
          });
          const memberId = memRes.data?.id;

          // Create Milestone
          csrf = await getCsrfToken();
          const mRes = await apiCall(`/organizations/${orgId}/projects/${proj.id}/milestones`, {
            method: 'POST',
            headers: {
              'x-csrf-token': csrf,
              'x-organization-principal': principalId
            },
            body: { title: 'Phase 1 Delivery & Review', position: 0, status: 'OPEN' }
          });

          // Create Task
          csrf = await getCsrfToken();
          const tRes = await apiCall(`/organizations/${orgId}/projects/${proj.id}/tasks`, {
            method: 'POST',
            headers: {
              'x-csrf-token': csrf,
              'x-organization-principal': principalId
            },
            body: {
              title: c.name === 'Nile Beverages' ? 'Complete storyboard cut' : 'Prepare creative assets presentation',
              description: 'Review with client stakeholders and sign off on first revision',
              milestone_id: mRes.data?.id,
              assignee_id: memberId,
              priority: 'HIGH',
              status: 'IN_PROGRESS',
              position: 0
            }
          });

          if (tRes.ok) {
            console.log(`      + Created task: ${tRes.data.title}`);
            // Add checklist item
            csrf = await getCsrfToken();
            await apiCall(`/organizations/${orgId}/projects/${proj.id}/tasks/${tRes.data.id}/checklist`, {
              method: 'POST',
              headers: {
                'x-csrf-token': csrf,
                'x-organization-principal': principalId
              },
              body: { label: 'Audio level check & HDR color export', position: 0, completed: false }
            });
          }
        }
      }
    }
  } else {
    console.log(`Found ${existingClients.length} existing clients. Skipping duplicate seed.`);
  }

  console.log('=== DEMO SEEDING COMPLETE! ===');
}

if (process.argv[1] && process.argv[1].endsWith('seed-production-demo.mjs')) {
  seedDemoData().catch(err => {
    console.error('Seed error:', err);
    process.exit(1);
  });
}
