import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Browser, admin } from '../phase2/helpers.mjs';
after(() => admin.end());
test('decision audit/outbox/receipt failure leaves no terminal facts and client scope rejects foreign principals', async () => {
  const f = JSON.parse(await readFile('.local/phase5-browser-fixture.json', 'utf8'));
  const pdf = JSON.parse(await readFile('.local/phase5-browser-pdf.json', 'utf8'));
  const browser = new Browser();
  await browser.login(f.approver2.email);
  const path = `/api/v1/organizations/${f.org}/portal/projects/${f.project}/reviews/${pdf.cycle}`;
  const headers = { 'X-Organization-Principal': f.approver2.id };
  const before = (
    await admin.query('SELECT count(*)::int n FROM public.audit_event WHERE target_id=$1', [
      pdf.cycle,
    ])
  ).rows[0].n;
  await admin.query(
    `CREATE FUNCTION public.phase5_outbox_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.organization_id='${f.org}'::uuid AND NEW.kind='review.changed' AND NEW.target_id='${pdf.cycle}' THEN RAISE EXCEPTION 'synthetic outbox fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER phase5_outbox_fault BEFORE INSERT ON public.tenant_event FOR EACH ROW EXECUTE FUNCTION public.phase5_outbox_fault()`,
  );
  try {
    const r = await browser.request(
      path + '/decisions',
      'POST',
      { version_id: pdf.version.id, digest: pdf.version.digest, decision: 'APPROVED', reason: '' },
      { ...headers, 'If-Match': '"1"', 'Idempotency-Key': crypto.randomUUID() },
    );
    assert.equal(r.status, 503, r.body);
    const facts = (
      await admin.query(
        'SELECT c.status,(SELECT count(*)::int FROM public.review_decision d WHERE d.cycle_id=c.id) decisions,(SELECT count(*)::int FROM public.approval a WHERE a.cycle_id=c.id) approvals FROM public.review_cycle c WHERE c.id=$1',
        [pdf.cycle],
      )
    ).rows[0];
    assert.equal(facts.status, 'OPEN');
    assert.equal(facts.decisions, 0);
    assert.equal(facts.approvals, 0);
    assert.equal(
      (
        await admin.query('SELECT count(*)::int n FROM public.audit_event WHERE target_id=$1', [
          pdf.cycle,
        ])
      ).rows[0].n,
      before,
    );
  } finally {
    await admin.query(
      'DROP TRIGGER phase5_outbox_fault ON public.tenant_event; DROP FUNCTION public.phase5_outbox_fault()',
    );
  }
  assert.equal(
    (
      await browser.request(path, 'GET', undefined, {
        'X-Organization-Principal': crypto.randomUUID(),
      })
    ).status,
    404,
  );
  assert.equal(
    (await browser.request(path.replace(f.org, crypto.randomUUID()), 'GET', undefined, headers))
      .status,
    404,
  );
  assert.equal(
    (
      await browser.request(
        `/api/v1/organizations/${f.org}/portal/projects/${f.project}/reviews?project_id=${crypto.randomUUID()}`,
        'GET',
        undefined,
        headers,
      )
    ).status,
    404,
  );
});
