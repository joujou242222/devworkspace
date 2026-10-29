import { readFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import assert from 'node:assert/strict';
const paths = [
  'AGENTS.md',
  'README.md',
  ...[
    'PRODUCT_SPEC',
    'ARCHITECTURE',
    'DATA_MODEL',
    'SECURITY',
    'IMPLEMENTATION_PLAN',
    'TESTING',
  ].map((name) => 'docs/' + name + '.md'),
  'docs/PHASE_1_REPORT.md',
  'docs/PHASE_1_NATIVE_INFRASTRUCTURE_REPORT.md',
  'docs/PHASE_2_REPORT.md',
  'docs/PHASE_3_REPORT.md',
  'docs/PHASE_4_REPORT.md',
  'docs/PHASE_5_REPORT.md',
  'docs/PHASE_6_REPORT.md',
  'docs/PHASE_7_REPORT.md',
  'docs/PHASE_8_REPORT.md',
  'docs/traceability/PHASE_8_ACTIONS.md',
  'docs/traceability/PHASE_7_COVERAGE.md',
  'docs/traceability/FEATURE_MATRIX.md',
  'docs/DEPENDENCY_VERSIONS.md',
  'infra/README.md',
];
let links = 0;
for (const path of paths) {
  const text = await readFile(path, 'utf8');
  assert.ok(!/[\t ]+$/m.test(text), 'Trailing whitespace ' + path);
  for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    if (/^https?:/.test(match[1])) continue;
    const [file, anchor] = match[1].split('#');
    const target = file ? resolve(dirname(path), file) : resolve(path);
    await access(target);
    if (anchor) {
      const body = await readFile(target, 'utf8');
      const slugs = [...body.matchAll(/^#{1,6} (.+)$/gm)].map((m) =>
        m[1]
          .toLowerCase()
          .replace(/[^\p{L}\p{N}_ -]/gu, '')
          .replaceAll(' ', '-'),
      );
      assert.ok(slugs.includes(anchor), 'Broken anchor ' + match[1]);
    }
    links++;
  }
}
const product = await readFile('docs/PRODUCT_SPEC.md', 'utf8');
const ids = [...product.matchAll(/^### (P\d{2}) — /gm)].map((m) => m[1]);
assert.deepEqual(
  ids,
  Array.from({ length: 36 }, (_, i) => 'P' + String(i + 1).padStart(2, '0')),
);
assert.equal((product.match(/; Core;/g) || []).length, 29);
assert.equal((product.match(/; Expansion;/g) || []).length, 7);
console.log(
  '36 page templates, 29/7 scope, links/anchors and whitespace verified (' + links + ' links)',
);
