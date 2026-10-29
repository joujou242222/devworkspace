import assert from 'node:assert/strict';
import { operations, responseSchemas } from '../../packages/contracts/dist/index.js';
function validate(value, schema, path = '$') {
  if (schema.anyOf || schema.oneOf) {
    const alternatives = schema.anyOf ?? schema.oneOf;
    const matches = alternatives.filter((branch) => {
      try {
        validate(value, branch, path);
        return true;
      } catch {
        return false;
      }
    }).length;
    assert.ok(schema.oneOf ? matches === 1 : matches >= 1, path + ' union');
    return;
  }
  if (schema.$ref) return validate(value, responseSchemas[schema.$ref.split('/').at(-1)], path);
  if (schema.const !== undefined) assert.equal(value, schema.const, path);
  if (schema.enum) assert.ok(schema.enum.includes(value), path + ' enum');
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (value === null) {
    assert.ok(types.includes('null'), path + ' nullable');
    return;
  }
  if (types.includes('object')) {
    assert.equal(typeof value, 'object', path);
    for (const key of schema.required ?? []) assert.ok(Object.hasOwn(value, key), path + '.' + key);
    for (const [key, item] of Object.entries(value)) {
      assert.ok(schema.properties[key], path + ' unknown property ' + key);
      validate(item, schema.properties[key], path + '.' + key);
    }
  } else if (types.includes('array')) {
    assert.ok(Array.isArray(value), path);
    for (const item of value) validate(item, schema.items, path + '[]');
  } else if (types.includes('string')) assert.equal(typeof value, 'string', path);
  else if (types.includes('integer')) assert.ok(Number.isInteger(value), path);
  else if (types.includes('number'))
    assert.ok(typeof value === 'number' && Number.isFinite(value), path);
  else if (types.includes('boolean')) assert.equal(typeof value, 'boolean', path);
  if (schema.format === 'uuid') assert.match(value, /^[a-f0-9-]{36}$/);
  if (schema.format === 'date-time') assert.ok(Number.isFinite(Date.parse(value)), path);
}
export function assertContract(path, method, response) {
  const op = operations.find(
    (row) =>
      row[1] === method.toLowerCase() &&
      new RegExp('^/api/v1' + row[2].replace(/\{[^}]+\}/g, '[^/]+') + '$').test(path.split('?')[0]),
  );
  if (!op) return;
  if (response.status < 300) {
    assert.equal(response.status, op[5], op[0] + ' status');
    validate(response.json(), responseSchemas[op[4]]);
  } else if (response.headers['content-type']?.includes('application/problem+json'))
    validate(response.json(), responseSchemas.problem);
}
