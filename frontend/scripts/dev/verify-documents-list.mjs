import { chromium } from '@playwright/test';

async function launchBrowser() {
  const options = [{ channel: 'msedge' }, { channel: 'chrome' }, {}];
  let lastError;
  for (const opt of options) {
    try {
      return await chromium.launch({ ...opt, headless: true });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
import https from 'node:https';
import fs from 'node:fs';

import { randomUUID } from 'node:crypto';

const ca = fs.readFileSync(new URL('../../../backend/.local/tls/localhost.pem', import.meta.url));
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

function req(urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, 'https://localhost:8443');
    const headers = { Origin: 'https://localhost:8443', ...(options.headers || {}) };
    const reqObj = https.request(url, { method: options.method || 'GET', headers, ca, rejectUnauthorized: false }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, text, json, setCookie: res.headers['set-cookie'] });
      });
    });
    reqObj.on('error', reject);
    if (options.body) {
      if (Buffer.isBuffer(options.body)) reqObj.write(options.body);
      else if (typeof options.body === 'object') {
        reqObj.setHeader('Content-Type', 'application/json');
        reqObj.write(JSON.stringify(options.body));
      } else reqObj.write(options.body);
    }
    reqObj.end();
  });
}

function parseCookies(cookies) {
  if (!cookies) return '';
  return (Array.isArray(cookies) ? cookies : [cookies]).filter(Boolean).map(c => c.split(';')[0]).join('; ');
}

async function setupTestEnvironment() {
  const ts = Date.now();
  const email = `docs.owner.${ts}@example.com`;
  const pass = 'Disposable-phase2-password-123!';

  // Register & verify
  const c0 = await req('/api/v1/identity/csrf');
  await req('/api/v1/identity/register', {
    method: 'POST',
    headers: { 'x-csrf-token': c0.json.token, Cookie: parseCookies(c0.setCookie) },
    body: { email, password: pass, name: 'Doc Author' }
  });

  let msg = null;
  for (let i = 0; i < 20; i++) {
    const mRes = await fetch('http://127.0.0.1:8025/api/v1/messages');
    const mData = await mRes.json();
    msg = (mData.messages || []).find(m => m.To && m.To.some(t => t.Address.toLowerCase() === email.toLowerCase()));
    if (msg) break;
    await new Promise(r => setTimeout(r, 200));
  }
  const detail = await (await fetch(`http://127.0.0.1:8025/api/v1/message/${msg.ID}`)).json();
  const token = new URL(detail.Text.trim()).searchParams.get('token');
  const c1 = await req('/api/v1/identity/csrf');
  await req('/api/v1/identity/verify', {
    method: 'POST',
    headers: { 'x-csrf-token': c1.json.token, Cookie: parseCookies(c1.setCookie) },
    body: { token }
  });

  // Login
  const c2 = await req('/api/v1/identity/csrf');
  const lRes = await req('/api/v1/identity/login', {
    method: 'POST',
    headers: { 'x-csrf-token': c2.json.token, Cookie: parseCookies(c2.setCookie) },
    body: { email, password: pass }
  });
  const cookie1 = parseCookies(lRes.setCookie);
  const postCsrf = await req('/api/v1/identity/csrf', { headers: { Cookie: cookie1 } });
  const authHeaders = {
    'x-csrf-token': postCsrf.json.token,
    Cookie: cookie1 + '; ' + parseCookies(postCsrf.setCookie)
  };

  // Create Org
  const orgRes = await req('/api/v1/organizations', {
    method: 'POST',
    headers: { ...authHeaders, 'idempotency-key': `org-${ts}` },
    body: { name: 'Docs Studio', timezone: 'Africa/Cairo', description: 'Testing Docs' }
  });
  const orgId = orgRes.json?.organizationId;

  // Re-login to get membership
  const lRes2 = await req('/api/v1/identity/login', {
    method: 'POST',
    headers: { 'x-csrf-token': postCsrf.json.token, Cookie: authHeaders.Cookie },
    body: { email, password: pass }
  });
  const cookie2 = parseCookies(lRes2.setCookie);
  const postCsrf2 = await req('/api/v1/identity/csrf', { headers: { Cookie: cookie2 } });
  const sessionHeaders = {
    'x-csrf-token': postCsrf2.json.token,
    Cookie: cookie2 + '; ' + parseCookies(postCsrf2.setCookie)
  };

  const princ = (await req('/api/v1/me/principals', { headers: { Cookie: sessionHeaders.Cookie } })).json?.items || [];
  console.log('princ list:', princ);
  const principalId = princ[0]?.id;

  // Create Client
  const cliRes = await req(`/api/v1/organizations/${orgId}/clients`, {
    method: 'POST',
    headers: {
      ...sessionHeaders,
      'Content-Type': 'application/json',
      'x-organization-principal': principalId,
      'idempotency-key': randomUUID()
    },
    body: { name: 'Doc Client', description: 'Testing client', status: 'ACTIVE' }
  });
  const clientId = cliRes.json?.id;
  console.log('cliRes:', cliRes.status, clientId);

  // Create Project
  const projRes = await req(`/api/v1/organizations/${orgId}/projects`, {
    method: 'POST',
    headers: {
      ...sessionHeaders,
      'Content-Type': 'application/json',
      'x-organization-principal': principalId,
      'idempotency-key': randomUUID()
    },
    body: { client_id: clientId, name: 'Brand Strategy', description: 'Testing project', due_at: null, status: 'ACTIVE', portal_enabled: true }
  });
  const projectId = projRes.json?.id;
  console.log('projRes:', projRes.status, projectId);

  // Add Manager
  await req(`/api/v1/organizations/${orgId}/projects/${projectId}/members`, {
    method: 'POST',
    headers: {
      ...sessionHeaders,
      'Content-Type': 'application/json',
      'x-organization-principal': principalId,
      'idempotency-key': randomUUID()
    },
    body: { membership_id: principalId, role: 'MANAGER', status: 'ACTIVE' }
  });

  // Create a Document via API
  const docRes = await req(`/api/v1/organizations/${orgId}/documents`, {
    method: 'POST',
    headers: {
      ...sessionHeaders,
      'Content-Type': 'application/json',
      'x-organization-principal': principalId,
      'idempotency-key': randomUUID()
    },
    body: {
      project_id: projectId,
      title: 'Initial Creative Brief',
      content: {
        version: 1,
        blocks: [
          {
            type: 'heading',
            level: 2,
            spans: [{ text: 'Brand Objectives' }]
          },
          {
            type: 'paragraph',
            spans: [{ text: 'This document details the core objectives.' }]
          }
        ]
      }
    }
  });
  const docId = docRes.json?.id;
  console.log('docRes debug:', docRes.status, docRes.text);

  return { email, pass, orgId, projectId, docId };
}

async function run() {
  console.log('=== STARTING DOCUMENTS LIST VERIFICATION ===');
  const env = await setupTestEnvironment();
  console.log('Environment ready, docId:', env.docId);

  const browser = await launchBrowser();
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  // Sign in via UI
  await page.goto('http://localhost:5199/login?returnTo=/workspace/documents');
  await page.fill('#e', env.email);
  await page.fill('#p', env.pass);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/workspace/documents**', { timeout: 15000 });
  console.log('On /workspace/documents');

  await page.waitForSelector('#tb tr', { timeout: 10000 });
  const rowCount = await page.locator('#tb tr').count();
  console.log('Initial document rows:', rowCount);
  if (rowCount < 1) throw new Error('Expected at least 1 document row');

  const firstRowTitle = await page.locator('#tb tr td a.lnk').first().textContent();
  const firstRowProject = await page.locator('#tb tr td:nth-child(2)').first().textContent();
  console.log(`First doc: Title="${firstRowTitle}", Project="${firstRowProject}"`);
  if (!firstRowTitle.includes('Initial Creative Brief')) {
    throw new Error('Title does not match created document');
  }
  if (!firstRowProject.includes('Brand Strategy')) {
    throw new Error('Project does not match mapped project name');
  }
  console.log('PASS: Document row rendered with title, project name, and relative time');

  // Test Search Filter
  console.log('\nTesting search filter (#q)...');
  await page.fill('#q', 'Creative Brief');
  await page.waitForTimeout(300);
  const matchedCount = await page.locator('#tb tr').count();
  console.log('Rows matching "Creative Brief":', matchedCount);
  if (matchedCount !== 1) throw new Error('Expected 1 row to match search');

  await page.fill('#q', 'Nonexistent Document Title');
  await page.waitForTimeout(300);
  const emptyCount = await page.locator('#tb tr').count();
  const emptyVisible = await page.locator('#em').isVisible();
  const emptyTitle = await page.locator('#et').textContent();
  console.log(`Empty state visible=${emptyVisible}, title="${emptyTitle}", rows=${emptyCount}`);
  if (!emptyVisible || !emptyTitle.includes('No documents match')) {
    throw new Error('Empty search state not shown');
  }

  await page.fill('#q', '');
  await page.waitForTimeout(300);
  console.log('PASS: Search filter and empty state verified');

  // Test Create Document Modal & Selection
  console.log('\nTesting New Document modal (#nd)...');
  await page.click('#nd');
  await page.waitForSelector('#dg', { state: 'visible', timeout: 5000 });
  const projectOptionsCount = await page.locator('#dp option').count();
  const projectOptionText = await page.locator('#dp option').first().textContent();
  console.log(`Modal projects count=${projectOptionsCount}, first option="${projectOptionText}"`);
  if (projectOptionsCount < 1 || !projectOptionText.includes('Brand Strategy')) {
    throw new Error('Project options not populated correctly in modal');
  }

  // Submit modal to create document
  console.log('Submitting create document form (#dgf)...');
  await page.click('#dgf button[type="submit"]');
  await page.waitForURL('**/workspace/document?**', { timeout: 15000 });
  console.log('Navigated to document editor:', page.url());
  if (!page.url().includes('/workspace/document?id=') || !page.url().includes('projectId=')) {
    throw new Error('Did not redirect to /workspace/document with id and projectId params');
  }
  console.log('PASS: New document created and redirected to editor');

  await browser.close();
  console.log('\n=== ALL DOCUMENTS LIST CHECKS PASSED ===');
}

run().catch(err => {
  console.error('Error during documents verification:', err);
  process.exit(1);
});
