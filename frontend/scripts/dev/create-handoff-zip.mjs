import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Repository root (three levels above frontend/scripts/dev)
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PARENT_DIR = path.dirname(REPO_ROOT);
const STAGING_DIR = path.join(PARENT_DIR, 'Devworkspace-Handoff-Staging');
const ZIP_OUTPUT = path.join(PARENT_DIR, 'Devworkspace-Complete-Project.zip');
const BACKEND_SRC = path.join(REPO_ROOT, 'backend');
const FRONTEND_SRC = path.join(REPO_ROOT, 'frontend');

console.log('=== STARTING CLEAN PROJECT HANDOFF PACKAGING ===');

// Clean existing staging and zip
if (fs.existsSync(STAGING_DIR)) {
  console.log('Cleaning existing staging directory...');
  fs.rmSync(STAGING_DIR, { recursive: true, force: true });
}
if (fs.existsSync(ZIP_OUTPUT)) {
  console.log('Removing old zip archive...');
  fs.unlinkSync(ZIP_OUTPUT);
}

fs.mkdirSync(STAGING_DIR, { recursive: true });
const backendDest = path.join(STAGING_DIR, 'backend');
const frontendDest = path.join(STAGING_DIR, 'frontend');
fs.mkdirSync(backendDest, { recursive: true });
fs.mkdirSync(frontendDest, { recursive: true });

function copyFiltered(srcDir, destDir, options = {}) {
  const { excludeDirs = [], excludeFiles = [], excludeExts = [] } = options;

  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      if (excludeDirs.includes(entry.name)) {
        continue;
      }
      copyFiltered(srcPath, destPath, options);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      if (excludeFiles.includes(entry.name)) continue;
      const ext = path.extname(entry.name);
      if (excludeExts.includes(ext)) continue;

      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// 1. Copy Frontend
console.log('1. Copying Frontend (devworkspace-react)...');
copyFiltered(FRONTEND_SRC, frontendDest, {
  excludeDirs: ['node_modules', '.git', 'dist'],
  excludeFiles: ['.DS_Store', 'Thumbs.db']
});
console.log('   Frontend copied cleanly.');

// 2. Copy Backend
console.log('2. Copying Backend (Devworkspace)...');
copyFiltered(BACKEND_SRC, backendDest, {
  excludeDirs: ['node_modules', '.git', '.local'],
  excludeFiles: ['devworkspace-react.zip', '.DS_Store', 'Thumbs.db']
});

// Copy specific essential .local configs, certs, and env files
console.log('   Copying sensitive environment files and .local configurations...');
const localSrc = path.join(BACKEND_SRC, '.local');
const localDest = path.join(backendDest, '.local');
fs.mkdirSync(localDest, { recursive: true });

if (fs.existsSync(localSrc)) {
  const localEntries = fs.readdirSync(localSrc, { withFileTypes: true });
  for (const entry of localEntries) {
    const srcPath = path.join(localSrc, entry.name);
    const destPath = path.join(localDest, entry.name);

    if (entry.isFile()) {
      // Include all .env files, credentials, json configs, and scripts
      if (
        entry.name.endsWith('.env') ||
        entry.name.endsWith('.json') ||
        entry.name.endsWith('.patch') ||
        entry.name.endsWith('.c') ||
        entry.name.endsWith('.mjs') ||
        entry.name === 'pg-password'
      ) {
        fs.copyFileSync(srcPath, destPath);
      }
    } else if (entry.isDirectory()) {
      // Copy tls certs and processing scripts
      if (['tls', 'processing'].includes(entry.name)) {
        copyFiltered(srcPath, destPath, {});
      }
    }
  }
}
console.log('   Backend and environment configurations copied cleanly.');

// 3. Write Root Developer Guide (START_HERE.md)
console.log('3. Writing Developer Handoff Guide (START_HERE.md)...');
const startHereContent = `# DevWorkspace — Complete Developer Handoff Guide

Welcome to the **DevWorkspace** full-stack SaaS codebase!

This package contains everything needed to run, develop, test, and extend the complete application:
- **Frontend** (\`./frontend\`): React 19, TypeScript, Vite MPA architecture, 36 responsive page templates, Phase 10 design system, and bidirectional Arabic (RTL) / English translation engine.
- **Backend** (\`./backend\`): Modular monolith with Express/NestJS, Better Auth identity, PostgreSQL multi-tenant RLS, Redis/BullMQ event workers, SeaweedFS private storage, and ClamAV sandboxing.
- **Environment & Secrets Included**: All \`.env.local\`, \`phase2-api.env\`, \`phase4-api.env\`, and database credentials are fully pre-configured for local development.

---

## ⚡ Quick Start (5 Minutes)

### Prerequisites
- **Node.js**: v20 or later (\`node -v\`)
- **pnpm**: \`npm install -g pnpm\`
- **Operating System**: Windows, macOS, or Linux

---

### Step 1: Start the Backend Services

Open your terminal in the \`backend\` folder:

\`\`\`bash
cd backend
pnpm install
pnpm native:up
pnpm dev
\`\`\`

- \`pnpm native:up\`: Starts the local native infrastructure (PostgreSQL on port 55432, Redis, and private S3 storage).
- \`pnpm dev\`: Starts the API gateway and worker services on **https://localhost:8443** (and http://127.0.0.1:3001).

---

### Step 2: Start the Frontend Application

Open a second terminal in the \`frontend\` folder:

\`\`\`bash
cd frontend
npm install
npm run dev
\`\`\`

The Vite application will start on:

👉 **http://localhost:5199**

---

## 🔑 Pre-Configured Demo Account

You do not need to register a new account to test the system. A complete showcase account is pre-seeded with projects, tasks, deliverables, and documents:

👉 **[http://localhost:5199/login?autofill=1](http://localhost:5199/login?autofill=1)**

| Field | Value |
|---|---|
| **URL** | [http://localhost:5199/login](http://localhost:5199/login) |
| **Email** | \`demo@agency.com\` |
| **Password** | \`Password123!\` |
| **Organization** | **Apex Digital Studio** |
| **Role** | Agency Owner / Lead |

*(You can also click the **Auto-fill** button on the sign-in card to instantly populate these credentials).*

---

## 🌐 Full Arabic (RTL) / English Translation

DevWorkspace includes an instant, bidirectional Arabic (RTL) / English translation system:
- Click the floating **\`[ 🌐 العربية / English ]\`** button at the bottom corner of any page (or in the top toolbar).
- Automatically flips layout direction to \`dir="rtl"\`, mirrors navigation sidebars, translates all statuses, menus, and forms into natural Arabic, while preserving all numbers and percentages as standard numerals (\`68%\`, \`0%\`, \`3\`).
- Your selection is remembered across all 36 pages in \`localStorage\`.

---

## 🗺️ Application Architecture & All 36 Pages

### 1. Core Workspace (\`./frontend/workspace\`)
- \`/workspace/dashboard\`: Executive KPI widgets, active projects, tasks, and activity feed.
- \`/workspace/projects\`: Client project portfolio, status filtering, and creation modal.
- \`/workspace/clients\`: Client accounts CRM and primary contact cards.
- \`/workspace/client\`: Deep client profile, contacts, and linked projects.
- \`/workspace/team\`: Team roster, role selection (Owner, Manager, Member, Approver), and invitations.
- \`/workspace/settings\`: Org settings, timezone, and brand logo upload via ClamAV staging.
- \`/workspace/account\`: Personal profile, active sessions with IP/user-agent parsing, avatar upload.
- \`/workspace/my-tasks\`: Personal cross-project task queue.
- \`/workspace/notifications\`: Inbox, read/unread filters, and notification preferences.
- \`/workspace/documents\`: OrbitSpace document list and creation modal.
- \`/workspace/document\`: Collaborative rich-text editor with structured JSON schema.
- \`/workspace/reviews\`: Review center and cross-project approval queue.
- \`/workspace/reports\`: Delivery metrics, task throughput, and milestone pacing.
- \`/workspace/audit\`: Append-only compliance audit trail.

### 2. LaunchFlow Project Delivery (\`./frontend/project\`)
- \`/project/project\`: Project overview, health indicator, and client update publishing.
- \`/project/project-tasks\`: Interactive task board, column moves, checklists, and assignments.
- \`/project/project-task\`: Detailed task view, checklists, and internal comment threads.
- \`/project/project-milestones\`: Milestone timeline, target dates, and deliverable linkages.
- \`/project/project-files\`: Quarantined asset vault with ClamAV staging scanning.
- \`/project/project-deliverables\`: Deliverable versions management and review cycles.
- \`/project/project-review\`: Proofly review canvas, image/PDF previews, and pin annotations.
- \`/project/project-access\`: Member roles and client approver/reviewer grants.
- \`/project/project-discussions\`: Threaded internal discussions.
- \`/project/project-activity\`: Detailed project audit timeline.

### 3. Client Portal (\`./frontend/portal\`)
- \`/portal/portal-projects\`: Client project directory.
- \`/portal/portal-project\`: Curated client milestones and shared files.
- \`/portal/portal-deliverables\`: Shared deliverables and exact-version review statuses.
- \`/portal/portal-review\`: Client review workspace, pin annotations, and formal approval recording.
- \`/portal/portal-updates\`: Aggregate client updates feed.
- \`/portal/portal-account\`: Client profile and active sessions.
- \`/portal/portal-notifications\`: Client notifications center.

---

## 🧪 Running Verification Tests

To verify all 39 browser integration test suites across every page:

\`\`\`bash
cd frontend
node scripts/dev/run-all-verifications.mjs
\`\`\`

To test Arabic translation specifically:

\`\`\`bash
node scripts/dev/verify-arabic-translation.mjs
\`\`\`

To test production build:

\`\`\`bash
npm run build
\`\`\`

---

## 📁 Repository Directory Structure

\`\`\`
.
├── START_HERE.md                  # This file
├── backend/                       # NestJS/Express modular monolith
│   ├── apps/                      # API and Worker apps
│   ├── packages/                  # Server, Database, Contracts, Config
│   ├── infra/                     # Infrastructure definitions
│   ├── scripts/                   # Native infra and dev scripts
│   ├── docs/                      # Specification, Architecture, Security docs
│   ├── .env.local                 # Local environment secrets & DB connection
│   └── .local/                    # Phase environment configs, TLS certificates
└── frontend/                      # React/TypeScript Vite application
    ├── src/                       # Design system, components, auth, i18n
    ├── workspace/                 # Workspace page HTML entry points
    ├── project/                   # Project page HTML entry points
    ├── portal/                    # Client Portal HTML entry points
    ├── scripts/                   # Playwright verification suites & seeders
    └── vite.config.js             # Vite clean-URL MPA & proxy configuration
\`\`\`

Enjoy building with DevWorkspace!
`;

fs.writeFileSync(path.join(STAGING_DIR, 'START_HERE.md'), startHereContent, 'utf8');
fs.writeFileSync(path.join(STAGING_DIR, 'README.md'), startHereContent, 'utf8');

// 4. Create ZIP archive using Windows built-in tar
console.log('4. Creating clean zip archive: ' + ZIP_OUTPUT + '...');
try {
  // tar -a automatically creates a .zip when the destination ends with .zip
  execSync(`tar -a -c -f "${ZIP_OUTPUT}" -C "${STAGING_DIR}" .`, { stdio: 'inherit' });
  console.log('   Zip archive created successfully!');
} catch (err) {
  console.error('Error creating zip with tar:', err);
  process.exit(1);
}

// 5. Inspect ZIP size
const stats = fs.statSync(ZIP_OUTPUT);
const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
console.log(`\n========================================================`);
console.log(`PACKAGE COMPLETED!`);
console.log(`  File: ${ZIP_OUTPUT}`);
console.log(`  Size: ${sizeMB} MB`);
console.log(`========================================================\n`);

// 6. Clean up staging directory
console.log('6. Cleaning up staging directory...');
fs.rmSync(STAGING_DIR, { recursive: true, force: true });
console.log('Done!');
