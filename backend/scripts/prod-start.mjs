import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

function runStep(cmd, args, opts = {}) {
  return new Promise((resolvePromise, reject) => {
    console.log(`[Prod Start] Running: ${cmd} ${args.join(' ')}`);
    const p = spawn(cmd, args, { stdio: 'inherit', shell: true, ...opts });
    p.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
    p.on('error', reject);
  });
}

async function main() {
  console.log('=== DEVWORKSPACE PRODUCTION BOOTSTRAP ===');

  // Step 1: Database Migrations (if DATABASE_URL is available)
  if (process.env.DATABASE_URL) {
    try {
      console.log('Step 1: Applying database migrations...');
      await runStep('npx', ['prisma', 'migrate', 'deploy'], {
        cwd: resolve(process.cwd(), 'packages/database/prisma/product')
      }).catch((e) => {
        console.warn('Prisma migrate warning (continuing):', e.message);
      });
    } catch (e) {
      console.warn('Migration step bypassed:', e.message);
    }
  }

  // Step 2: Seed Mock/Demo Data (demo@agency.com)
  try {
    console.log('Step 2: Checking and seeding demo dataset...');
    await runStep('node', ['scripts/seed-production-demo.mjs']).catch((e) => {
      console.warn('Seed script warning (continuing):', e.message);
    });
  } catch (e) {
    console.warn('Seed step bypassed:', e.message);
  }

  // Step 3: Start Services
  console.log('Step 3: Launching DevWorkspace API...');
  const children = [];

  const apiProcess = spawn('node', ['apps/api/dist/main.js'], { stdio: 'inherit' });
  children.push(apiProcess);

  if (process.env.RUN_WORKER_INLINE === 'true') {
    console.log('Step 3b: Launching DevWorkspace Worker inline...');
    const workerProcess = spawn('node', ['apps/worker/dist/main.js'], { stdio: 'inherit' });
    children.push(workerProcess);
  }

  const cleanup = () => {
    for (const c of children) {
      try { c.kill(); } catch (_) {}
    }
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch((err) => {
  console.error('Fatal bootstrap error:', err);
  process.exit(1);
});
