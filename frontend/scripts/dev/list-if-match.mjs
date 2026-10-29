import fs from 'node:fs';

const spec = JSON.parse(fs.readFileSync(new URL('../../backend/packages/contracts/openapi.json', import.meta.url), 'utf8'));
const endpoints = [];

for (const [path, methods] of Object.entries(spec.paths)) {
  for (const [method, op] of Object.entries(methods)) {
    const params = op.parameters || [];
    const ifMatch = params.find(p => p.name && p.name.toLowerCase() === 'if-match');
    if (ifMatch) {
      endpoints.push({
        method: method.toUpperCase(),
        path,
        required: Boolean(ifMatch.required),
        operationId: op.operationId || '',
        summary: op.summary || ''
      });
    }
  }
}

console.log(`Found ${endpoints.length} mutation endpoints with If-Match:`);
for (const e of endpoints) {
  console.log(`${e.method.padEnd(7)} ${e.path.padEnd(60)} required=${e.required}`);
}
