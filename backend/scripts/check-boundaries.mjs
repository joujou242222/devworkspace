import ts from 'typescript';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
export const allowed = {
  web: ['contracts'],
  api: ['server', 'database', 'contracts'],
  worker: ['server', 'database'],
  server: ['database', 'contracts'],
  database: [],
  contracts: [],
  config: [],
};
export function violationsFor(name, file, text) {
  const failures = [];
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  function check(spec) {
    if (spec.startsWith('@devworkspace/')) {
      const target = spec.split('/')[1];
      if (!(allowed[name] ?? []).includes(target)) failures.push(name + ' cannot import ' + spec);
    }
    if (spec.startsWith('.') || spec.startsWith('/')) {
      const target = resolve(dirname(file), spec);
      const root = resolve(file.startsWith('apps/') ? 'apps' : 'packages', name);
      if (!target.startsWith(root + '/') && !target.startsWith(root + '\\'))
        failures.push(name + ' cannot escape package with ' + spec);
    }
  }
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      check(node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteral(argument)) check(argument.text);
      else failures.push('Nonliteral dynamic import/require is forbidden: ' + file);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return failures;
}
async function walk(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.next', 'generated', 'generated-product'].includes(entry.name))
      continue;
    const file = directory + '/' + entry.name;
    if (entry.isDirectory()) result.push(...(await walk(file)));
    else if (/\.(ts|tsx|mjs)$/.test(file) && !file.endsWith('next-env.d.ts')) result.push(file);
  }
  return result;
}
export async function checkBoundaries() {
  const failures = [];
  for (const prefix of ['apps', 'packages'])
    for (const entry of await readdir(prefix, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifest = JSON.parse(
        await readFile(prefix + '/' + entry.name + '/package.json', 'utf8'),
      );
      for (const dependency of Object.keys({
        ...manifest.dependencies,
        ...manifest.devDependencies,
      }))
        if (
          dependency.startsWith('@devworkspace/') &&
          !(allowed[entry.name] ?? []).includes(dependency.split('/')[1])
        )
          failures.push('Forbidden manifest dependency ' + manifest.name + ' -> ' + dependency);
      for (const file of await walk(prefix + '/' + entry.name))
        failures.push(
          ...violationsFor(
            entry.name,
            relative(process.cwd(), resolve(file)).replaceAll('\\', '/'),
            await readFile(file, 'utf8'),
          ),
        );
    }
  return failures;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const failures = await checkBoundaries();
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else console.log('Workspace manifest and AST import boundaries passed');
}
