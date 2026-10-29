import { execSync } from 'child_process';
import { fileURLToPath } from 'node:url';

// Frontend project directory (the folder two levels above this script)
const FRONTEND_DIR = fileURLToPath(new URL('../..', import.meta.url));
const SCRIPTS_REL = 'scripts/dev';

const scripts = [
  'verify-group1-browser.mjs',
  'verify-dashboard-browser.mjs',
  'verify-dashboard-widgets.mjs',
  'verify-projects-browser.mjs',
  'verify-projects-advanced.mjs',
  'verify-my-tasks-browser.mjs',
  'verify-my-tasks-roles.mjs',
  'verify-clients-browser.mjs',
  'verify-client-detail-browser.mjs',
  'verify-team-browser.mjs',
  'verify-team-roles.mjs',
  'verify-portal-enabled-api.mjs',
  'verify-notifications-browser.mjs',
  'verify-account-browser.mjs',
  'verify-account-upload.mjs',
  'verify-settings-browser.mjs',
  'verify-settings-upload.mjs',
  'verify-access-layer.mjs',
  'verify-project-overview-browser.mjs',
  'verify-project-tasks-browser.mjs',
  'verify-project-task-browser.mjs',
  'verify-project-milestones-browser.mjs',
  'verify-project-access-browser.mjs',
  'verify-project-discussions-browser.mjs',
  'verify-project-activity-browser.mjs',
  'verify-documents-list.mjs',
  'verify-document-editor.mjs',
  'verify-reports-browser.mjs',
  'verify-reviews-browser.mjs',
  'verify-project-files-browser.mjs',
  'verify-project-deliverables-browser.mjs',
  'verify-project-review-browser.mjs',
  'verify-portal-projects-browser.mjs',
  'verify-portal-project-browser.mjs',
  'verify-portal-deliverables-browser.mjs',
  'verify-portal-review-browser.mjs',
  'verify-portal-updates-browser.mjs',
  'verify-portal-account-browser.mjs',
  'verify-portal-notifications-browser.mjs',
  'verify-arabic-translation.mjs'
];

console.log(`Running all ${scripts.length} verification suites...`);
let passed = 0;
const results = [];

for (const script of scripts) {
  const start = Date.now();
  process.stdout.write(`- Running ${script}... `);
  try {
    execSync(`node ${SCRIPTS_REL}/${script}`, {
      cwd: FRONTEND_DIR,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const dur = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`PASS (${dur}s)`);
    passed++;
    results.push({ script, status: 'PASS', duration: `${dur}s` });
  } catch (err) {
    const dur = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`FAIL (${dur}s)`);
    console.error(err.stdout ? err.stdout.toString() : '');
    console.error(err.stderr ? err.stderr.toString() : '');
    results.push({ script, status: 'FAIL', duration: `${dur}s` });
    break;
  }
}

console.log(`\n========================================`);
console.log(`SUMMARY: ${passed}/${scripts.length} suites pass`);
console.log(`========================================`);

if (passed !== scripts.length) {
  process.exit(1);
}
