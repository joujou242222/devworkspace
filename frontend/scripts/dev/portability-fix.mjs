#!/usr/bin/env node
/**
 * One-time portability fix for frontend/scripts/dev/*.mjs
 * Removes Windows-only absolute paths left from the original development machine:
 *   1. Playwright import via file:///D:/...  → use packaged dependency
 *   2. chromium msedge-only launches          → portable multi-channel fallback
 *   3. TLS CA file paths D:/Devworkspace/.local/tls/... → repo-relative
 *   4. Misc absolute doc/spec/output paths   → repo-relative
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = new URL('.', import.meta.url); // frontend/scripts/dev

const files = readdirSync(dir.pathname ?? dir).filter((f) => f.endsWith('.mjs'));

let touched = 0;
for (const name of files) {
  const fileUrl = new URL(name, dir);
  const src = readFileSync(fileUrl, 'utf8');
  let out = src;
  let changed = false;

  // 1. Playwright windows import
  const pwImport =
    /import pkg from 'file:\/\/\/D:\/Devworkspace\/node_modules\/@playwright\/test\/index\.js';\s*\nconst \{ chromium \} = pkg;/;
  if (pwImport.test(out)) {
    out = out.replace(pwImport, "import { chromium } from '@playwright/test';");
    changed = true;
  }

  // 1b. any remaining bare windows import
  const pwAlt = /from 'file:\/\/\/D:\/Devworkspace\/node_modules\/@playwright\/test\/index\.js';/g;
  if (pwAlt.test(out)) {
    out = out.replace(pwAlt, "from '@playwright/test';");
    changed = true;
  }

  // 1c. portable browser launcher (msedge → chrome → bundled chromium)
  const msedgeLaunch = /const browser = await chromium\.launch\(\{ channel: 'msedge', headless: true \}\);/;
  if (!/launchBrowser/.test(out) && msedgeLaunch.test(out)) {
    out = out.replace(
      msedgeLaunch,
      'const browser = await launchBrowser();',
    );
    // insert helper after the playwright import line
    out = out.replace(
      /import \{ chromium \} from '@playwright\/test';/,
      "import { chromium } from '@playwright/test';\n\n" +
        "async function launchBrowser() {\n" +
        "  const options = [{ channel: 'msedge' }, { channel: 'chrome' }, {}];\n" +
        "  let lastError;\n" +
        "  for (const opt of options) {\n" +
        "    try {\n" +
        "      return await chromium.launch({ ...opt, headless: true });\n" +
        "    } catch (error) {\n" +
        "      lastError = error;\n" +
        "    }\n" +
        "  }\n" +
        "  throw lastError;\n" +
        '}',
    );
    changed = true;
  } else if (/launchBrowser/.test(out) && msedgeLaunch.test(out)) {
    out = out.replace(msedgeLaunch, 'const browser = await launchBrowser();');
    changed = true;
  }

  // paths inserted into scripts located at frontend/scripts/dev/*.mjs
  const caUrlJs = "new URL('../../../backend/.local/tls/localhost.pem', import.meta.url)";
  const docUrlJs = "new URL('../../docs/ROLE_ACCESS.md', import.meta.url)";
  const openapiUrlJs = "new URL('../../backend/packages/contracts/openapi.json', import.meta.url)";

  if (/fs\.readFileSync\('D:\/Devworkspace\/\.local\/tls\/localhost\.pem'\)/.test(out)) {
    out = out.replace(
      /fs\.readFileSync\('D:\/Devworkspace\/\.local\/tls\/localhost\.pem'\)/g,
      'fs.readFileSync(' + caUrlJs + ')',
    );
    changed = true;
  }
  if (/fs\.writeFileSync\('d:\/devworkspace-react\/docs\/ROLE_ACCESS\.md'/i.test(out)) {
    out = out.replace(
      /fs\.writeFileSync\('d:\/devworkspace-react\/docs\/ROLE_ACCESS\.md'/i,
      'fs.writeFileSync(' + docUrlJs,
    );
    changed = true;
  }
  if (/fs\.readFileSync\('d:\/Devworkspace\/packages\/contracts\/openapi\.json'/i.test(out)) {
    out = out.replace(
      /fs\.readFileSync\('d:\/Devworkspace\/packages\/contracts\/openapi\.json'/i,
      'fs.readFileSync(' + openapiUrlJs,
    );
    changed = true;
  }

  if (changed) {
    writeFileSync(fileUrl, out, 'utf8');
    touched++;
    console.log('fixed', name);
  }
}
console.log(touched, 'files updated');
