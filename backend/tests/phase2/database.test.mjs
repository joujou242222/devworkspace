import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Pool, Client } from 'pg';
import { createTenantPrisma, TenantDatabase } from '../../packages/database/dist/index.js';
import { admin, account, tenant, runtime } from './helpers.mjs';
after(() => admin.end());
test('V02/T03: runtime roles are nonowner/nonbypass; no-context, invalid-context, DDL, global identity and worker denial', async () => {
  const d = new TenantDatabase(runtime.PRODUCT_API_URL, 1);
  const creds = JSON.parse(await readFile('.local/phase2-credentials.json', 'utf8'));
  try {
    const role = (
      await d.pool.query(
        'SELECT current_user,rolsuper,rolbypassrls,rolcreaterole FROM pg_roles WHERE rolname=current_user',
      )
    ).rows[0];
    assert.equal(role.current_user, 'dw2_api');
    assert.equal(role.rolsuper, false);
    assert.equal(role.rolbypassrls, false);
    assert.equal(role.rolcreaterole, false);
    const tables = (
      await admin.query(
        "SELECT relname,relrowsecurity,relforcerowsecurity,pg_get_userbyid(relowner) AS owner FROM pg_class WHERE relname IN ('organization','membership','invitation','audit_event','tenant_event','tenant_mail','command_receipt')",
      )
    ).rows;
    assert.equal(tables.length, 7);
    for (const table of tables) {
      assert.ok(table.relrowsecurity && table.relforcerowsecurity);
      assert.equal(table.owner, 'dw2_owner');
    }
    assert.equal((await d.pool.query('SELECT count(*) FROM organization')).rows[0].count, '0');
    await d.transaction('invalid', async (tx) =>
      assert.equal((await tx.query('SELECT count(*) FROM membership')).rows[0].count, '0'),
    );
    for (const sql of [
      'SELECT * FROM identity_user',
      'SELECT * FROM identity_account',
      'SELECT * FROM identity_mail',
      'CREATE TABLE public.bad(id int)',
      'TRUNCATE organization',
      'SET ROLE dw2_owner',
      "UPDATE audit_event SET action='bad'",
      'DELETE FROM audit_event',
    ])
      await assert.rejects(d.pool.query(sql));
    for (const role of ['worker', 'dispatch', 'identity']) {
      const u = new URL(runtime.PRODUCT_API_URL);
      u.username = 'dw2_' + role;
      u.password = creds[role];
      const p = new Pool({ connectionString: u.href });
      try {
        await assert.rejects(p.query('SELECT * FROM organization'));
        await assert.rejects(p.query('SET ROLE dw2_owner'));
      } finally {
        await p.end();
      }
    }
  } finally {
    await d.close();
  }
});
test('V02/T03/T06: same Prisma transaction, nested/raw reads, A/B pool reuse, concurrent contexts and rollback', async () => {
  const a = await account(),
    b = await account();
  const ta = await tenant(a),
    tb = await tenant(b);
  const prisma = createTenantPrisma(runtime.PRODUCT_API_URL, 1);
  try {
    for (let i = 0; i < 12; i++) {
      const t = i % 2 ? ta : tb;
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.organization_id',${t.organizationId},true)`;
        const rows = await tx.organization.findMany({ include: { memberships: true } });
        assert.equal(rows.length, 1);
        assert.equal(rows[0].id, t.organizationId);
        assert.equal(rows[0].memberships.length, 1);
        assert.equal(rows[0].memberships[0].organizationId, t.organizationId);
        const raw = await tx.$queryRaw`SELECT organization_id FROM membership`;
        assert.ok(raw.every((r) => r.organization_id === t.organizationId));
      });
      assert.equal(await prisma.organization.count(), 0);
    }
    await assert.rejects(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.organization_id',${ta.organizationId},true)`;
        await tx.organization.update({
          where: { id: ta.organizationId },
          data: { description: 'MUST ROLL BACK' },
        });
        throw new Error('controlled rollback');
      }),
    );
    assert.equal(await prisma.organization.count(), 0);
    const db = new TenantDatabase(runtime.PRODUCT_API_URL, 4);
    try {
      await Promise.all(
        Array.from({ length: 16 }, (_, i) =>
          db
            .transaction(i % 2 ? ta.organizationId : tb.organizationId, async (tx) => {
              const id = i % 2 ? ta.organizationId : tb.organizationId;
              const rows = (await tx.query('SELECT id FROM organization')).rows;
              assert.deepEqual(
                rows.map((r) => r.id),
                [id],
              );
              await assert.rejects(
                tx.query(
                  'INSERT INTO invitation(organization_id,inviter_id,email,role,digest) VALUES($1,$2,$3,$4,$5)',
                  [
                    id,
                    i % 2 ? tb.principal.id : ta.principal.id,
                    'cross@example.test',
                    'MEMBER',
                    crypto.randomUUID(),
                  ],
                ),
                (e) => e.code === '23503',
              );
            })
            .catch((e) => {
              if (e.code !== '25P02') throw e;
            }),
        ),
      );
    } finally {
      await db.close();
    }
    assert.equal(
      (await admin.query('SELECT description FROM organization WHERE id=$1', [ta.organizationId]))
        .rows[0].description,
      'Synthetic test',
    );
    assert.equal((await a.browser.request(tb.path, 'GET', undefined, ta.headers)).status, 404);
  } finally {
    await prisma.$disconnect();
  }
});
test('V02/T06/T20: immutable tenant scope, cross-tenant insert, append-only audit/events and database last-owner backstop', async () => {
  const a = await account(),
    b = await account();
  const ta = await tenant(a),
    tb = await tenant(b);
  const db = new TenantDatabase(runtime.PRODUCT_API_URL, 1);
  try {
    const fail = async (sql, args, code) =>
      assert.rejects(
        db.transaction(ta.organizationId, (tx) => tx.query(sql, args)),
        (e) => e.code === code,
      );
    await fail(
      'UPDATE membership SET organization_id=$1 WHERE id=$2',
      [tb.organizationId, ta.principal.id],
      '23514',
    );
    await fail(
      'INSERT INTO membership(id,organization_id,user_id,role) VALUES($1,$2,$3,$4)',
      [crypto.randomUUID(), tb.organizationId, a.user.id, 'MEMBER'],
      '42501',
    );
    await fail("UPDATE membership SET role='MEMBER' WHERE id=$1", [ta.principal.id], '23514');
    await fail(
      "UPDATE audit_event SET action='tampered' WHERE organization_id=$1",
      [ta.organizationId],
      '42501',
    );
    await fail(
      "UPDATE tenant_event SET kind='organization.updated' WHERE organization_id=$1",
      [ta.organizationId],
      '42501',
    );
    assert.equal(
      (await a.browser.request('/api/v1/me')).status,
      200,
      'Failed owner demotion must roll back session revocation',
    );
  } finally {
    await db.close();
  }
});
test('V02: clean database migrations install the same constraints, roles and forced RLS without touching retained data', async () => {
  const name = 'devworkspace_p2_validation_' + crypto.randomUUID().replaceAll('-', '');
  await admin.query(`CREATE DATABASE ${name} OWNER dw2_owner`);
  const u = new URL(runtime.PRODUCT_API_URL);
  u.username = process.env.POSTGRES_USER;
  u.password = process.env.POSTGRES_PASSWORD;
  u.pathname = '/' + name;
  const db = new Client({ connectionString: u.href });
  await db.connect();
  try {
    await db.query('BEGIN');
    await db.query('SET LOCAL ROLE dw2_owner');
    for (const file of [
      '0001-generated.sql',
      '0002-security.sql',
      '0003-hardening.sql',
      '0004-privilege-revocation.sql',
      '0005-identity-eligibility.sql',
      '0006-integrity.sql',
      '0007-scope-errors.sql',
      '0008-delivery-replay.sql',
      '0009-principal-pagination.sql',
    ])
      await db.query(await readFile('packages/database/prisma/product/' + file, 'utf8'));
    await db.query('COMMIT');
    assert.equal(
      (
        await db.query(
          "SELECT count(*) FROM pg_class WHERE relname IN ('membership','organization') AND relforcerowsecurity",
        )
      ).rows[0].count,
      '2',
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*) FROM pg_constraint WHERE conname IN ('membership_owner','organization_owner') AND condeferrable AND condeferred",
        )
      ).rows[0].count,
      '2',
    );
  } finally {
    await db.end();
  }
  // Retain the uniquely named empty validation database for inspection; no DROP.
});
