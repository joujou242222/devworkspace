import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalAnnotationPoint,
  annotationSchema,
  reviewSchemas,
  safeReturnPath,
} from '../../packages/contracts/dist/index.js';
test('canonical pin coordinates undo clockwise display rotation and scaled scrolled viewport offsets', () => {
  const x = 0.2,
    y = 0.7;
  for (const [rotation, sx, sy] of [
    [0, x, y],
    [90, 1 - y, x],
    [180, 1 - x, 1 - y],
    [270, y, 1 - x],
  ]) {
    for (const scale of [0.25, 1, 3]) {
      const width = 800 * scale,
        height = 600 * scale,
        left = -130,
        top = 92;
      const px = left + sx * width,
        py = top + sy * height;
      const p = canonicalAnnotationPoint((px - left) / width, (py - top) / height, rotation);
      assert.ok(Math.abs(p.x - x) < 1e-12);
      assert.ok(Math.abs(p.y - y) < 1e-12);
    }
  }
});
test('annotation DTO rejects NaN/infinity/bounds, wrong page and unknown geometry, decision reason and portal redirect injection', () => {
  for (const x of [NaN, Infinity, -0.01, 1.01])
    assert.equal(annotationSchema.safeParse({ type: 'IMAGE_PIN', x, y: 0.5 }).success, false);
  assert.equal(
    annotationSchema.safeParse({ type: 'PDF_POINT', page: 0, x: 0.5, y: 0.5 }).success,
    false,
  );
  assert.equal(
    annotationSchema.safeParse({ type: 'IMAGE_PIN', x: 0.5, y: 0.5, page: 2 }).success,
    false,
  );
  assert.equal(
    reviewSchemas.reviewDecision.safeParse({
      version_id: crypto.randomUUID(),
      digest: 'a'.repeat(64),
      decision: 'CHANGES_REQUESTED',
      reason: ' ',
    }).success,
    false,
  );
  const org = crypto.randomUUID(),
    project = crypto.randomUUID();
  assert.equal(safeReturnPath(`/portal/${org}/projects`), `/portal/${org}/projects`);
  assert.equal(
    safeReturnPath(`/portal/${org}/projects/${project}/deliverables`),
    `/portal/${org}/projects/${project}/deliverables`,
  );
  assert.equal(
    safeReturnPath(`/portal/${org}/projects/${project}/reviews/${crypto.randomUUID()}`)?.startsWith(
      '/portal/',
    ),
    true,
  );
  assert.equal(safeReturnPath(`/portal/${org}/projects?next=https://evil.example`), null);
});
