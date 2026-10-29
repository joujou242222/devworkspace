#!/usr/bin/env node
/**
 * Frontend ↔ Backend endpoint cross-check.
 * 1. Scans frontend src/lib + src/pages for api.get/post/patch/del call literal paths
 *    (string literals and simple concatenations), normalizing ids into {} params.
 * 2. Scans backend packages/contracts/src/operations.ts for the [name, method, path, ...] table.
 * 3. Reports: (a) frontend calls with NO backend match, (b) backend ops never called (informational).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { posix as p } from 'node:path';

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const f = p.join(dir, e);
    const st = statSync(f);
    if (st.isDirectory()) walk(f, out);
    else out.push(f);
  }
  return out;
}

const ROOT = process.argv[2] || process.cwd();
const FRONT = p.join(ROOT, 'frontend');
const BACK = p.join(ROOT, 'backend');

// ---------- 1. Frontend call extraction ----------
const feFiles = [
  ...walk(p.join(FRONT, 'src/lib')).filter((f) => f.endsWith('.js')),
  ...walk(p.join(FRONT, 'src/pages')).filter((f) => f.endsWith('.js.txt') || f.endsWith('.jsx')),
].filter((f) => !p.basename(f).includes('globalBehaviors'));

const urlArg = /(?:api\.(?:get|post|patch|put|del|delete)|fileUpload|raw)\(\s*(['"`])([\s\S]*?)\1/gi;
// matches: api.get('/organizations/' + orgId + '/audit?...')  — arg quoted segments joined by + expr +
const callExpr = /api\.(get|post|patch|put|del|delete)\(\s*([\s\S]{0,400}?)(?:,\s*\{|\)|;|\n\))$/gim;

function normalizeLiteral(s) {
  // string-literal arg like '/me/image/content?v=' + x … is handled by expr path;
  // here handle pure literal
  return s;
}

const called = new Map(); // key: "GET /organizations/{}/audit" → count
function recordCall(method, rawPath, src) {
  method = method.toUpperCase();
  if (method === 'DEL') method = 'DELETE';
  // strip query for template matching
  let path = rawPath.split('?')[0];
  if (!path) return;
  path = path.trim();
  const key = method + ' ' + path;
  called.set(key, { method, path, src, rawPath });
}

for (const f of feFiles) {
  const text = readFileSync(f, 'utf8');
  // Pattern A: fully-quoted first argument, possibly with concatenation:
  //   api.get(  '/organizations/' + orgId + '/audit'  ...
  const callHead = /api\.(get|post|patch|put|del|delete)\(/gi;
  let m;
  while ((m = callHead.exec(text))) {
    const method = m[1].toUpperCase() === 'DEL' ? 'DELETE' : m[1].toUpperCase();
    // walk to find end of FIRST argument (path): end at a depth-0 comma, or the call's paren
    const start = m.index + m[0].length;
    let end = start;
    let depth = 0;
    for (let i = start; i < Math.min(text.length, start + 600); i++) {
      const c = text[i];
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')') {
        if (depth === 0) {
          end = i;
          break;
        }
        depth--;
      } else if (c === ']') depth--;
      else if (c === '}') {
        depth--;
        if (depth < 0) depth = 0;
      } else if (c === ',' && depth === 0) {
        end = i;
        break;
      }
    }
    const arg = text.slice(start, end);
    // path portion = everything before the first top-level comma (args separator)
    let pathSrc = arg;
    let d = 0;
    for (let i = 0; i < arg.length; i++) {
      const c = arg[i];
      if (c === '(' || c === '[' || c === '{') d++;
      else if (c === ')') {
        d--;
        if (d < 0) break;
      } else if (c === ']') d--;
      else if (c === '}') d--;
      else if (c === ',' && d === 0) {
        pathSrc = arg.slice(0, i);
        break;
      }
    }
    // join literal segments with {} for expression gaps
    let norm = '';
    let lastEnd = 0;
    const litRe = /(['"`])([^'"`\\]*)\1/gim;
    let lit;
    let hasLiteral = false;
    while ((lit = litRe.exec(pathSrc))) {
      hasLiteral = true;
      if (lit.index > lastEnd) {
        const between = pathSrc.slice(lastEnd, lit.index).replace(/[\s()+]/g, '');
        if (between.length) norm += '{}';
      }
      norm += lit[2];
      lastEnd = litRe.lastIndex;
    }
    if (!hasLiteral) continue;
    // trailing expression after last literal (e.g. '/me/sessions/' + sessionId) → id
    if (lastEnd < pathSrc.length) {
      const tail = pathSrc.slice(lastEnd).replace(/[\s()+]/g, '');
      if (tail.length) norm += '{}';
    }
    norm = norm.replace(/\{\}+/g, '{}');
    if (!norm.startsWith('/api/v1') && !norm.startsWith('http')) norm = '/api/v1' + norm.replace(/^\/api\/v1/, '');
    if (norm.startsWith('/api/v1')) norm = norm.slice(7);
    if (!norm.startsWith('/')) norm = '/' + norm;
    // skip dynamic-only urls (variable base, entropy-only paths)
    const meaningful = norm.replace(/\/\{\}|\{\}/g, '').replace(/\//g, '');
    if (meaningful.length < 2) continue;
    recordCall(method, norm, p.relative(FRONT, f));
  }
  // Pattern B: template literals with ${}
  const tl = /api\.(get|post|patch|put|del|delete)\(\s*(`[^`]*`)/gi;
  let t;
  while ((t = tl.exec(text))) {
    const method = t[1].toUpperCase() === 'DEL' ? 'DELETE' : t[1].toUpperCase();
    let norm = t[2].replace(/\$\{[^}]*\}/g, '{}');
    if (!norm.startsWith('/api/v1') && !norm.startsWith('http')) norm = norm;
    if (norm.startsWith('`')) norm = norm.slice(1, -1);
    if (!norm.startsWith('http')) {
      if (norm.startsWith('/api/v1')) norm = norm.slice(7);
      if (!norm.startsWith('/')) norm = '/' + norm;
      recordCall(method, norm, p.relative(FRONT, f));
    }
  }
}

// ---------- 2. Backend operations table ----------
const opsText = readFileSync(p.join(BACK, 'packages/contracts/src/operations.ts'), 'utf8');
const backend = new Map(); // "METHOD /path" → name
const opRe = /\[\s*'([a-z][\w]+)'\s*,\s*'(get|post|patch|put|delete)'\s*,\s*'([^']+)'/gim;
let o;
while ((o = opRe.exec(opsText))) {
  const key = o[2].toUpperCase() + ' ' + o[3];
  backend.set(key, o[1]);
}

function templateMatches(callPath, opPath) {
  const cp = callPath.split('/').filter(Boolean);
  const op = opPath.split('/').filter(Boolean);
  if (cp.length !== op.length) return false;
  for (let i = 0; i < cp.length; i++) {
    const a = cp[i];
    const b = op[i];
    if (b.startsWith('{')) continue; // any id segment
    if (a === b) continue;
    // static-literal segments in the call may equal op id anyway → mismatch otherwise
    return false;
  }
  return true;
}

// ---------- 3. Compare ----------
const missing = [];
const matchedOps = new Set();
for (const [key, call] of called) {
  const [method, path] = [call.method, call.path];
  let found = null;
  for (const [bkey, name] of backend) {
    const [bm, bp] = [bkey.slice(0, bkey.indexOf(' ')), bkey.slice(bkey.indexOf(' ') + 1)];
    if (bm !== method) continue;
    if (bp === path || templateMatches(path, bp)) {
      found = name;
      matchedOps.add(bkey);
      break;
    }
  }
  if (!found) missing.push({ ...call, key });
}

console.log('=== CROSS-CHECK SUMMARY ===');
console.log('Frontend call sites (unique templates):', called.size);
console.log('Backend operations:', backend.size);
console.log('Backend ops covered by ≥1 frontend call:', matchedOps.size);

console.log('\n=== FRONTEND CALLS WITH NO BACKEND OPERATION (potential broken wiring) ===');
if (!missing.length) console.log('(none)');
for (const c of missing) console.log(' ✗', c.key, '   ←', c.src);

console.log('\n=== BACKEND OPERATIONS WITH NO FRONTEND CALLER (informational) ===');
const unreferenced = [...backend.keys()].filter((k) => !matchedOps.has(k));
for (const k of unreferenced) console.log(' ·', k, '(' + backend.get(k) + ')');
