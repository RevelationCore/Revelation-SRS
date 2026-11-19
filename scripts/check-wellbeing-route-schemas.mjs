// Fails if any wellbeing route lacks a request schema (enterprise readiness
// plan, item 1.7). Reads modules/wellbeing/openapi/v1.json, which CI
// regenerates and diffs first, so the spec is the routes as registered.
//
//   - every operation carries tags and a summary (only a route with a
//     schema gets them, so a route registered without one fails here);
//   - every path parameter is declared, and an id parameter is a UUID;
//   - every POST, PUT and PATCH declares its body, unless listed below.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const spec = JSON.parse(readFileSync(resolve(root, 'modules/wellbeing/openapi/v1.json'), 'utf8'));

/** Writes that take no JSON body, and why. */
const NO_BODY = new Map([
  ['post /api/v1/adjustment-cases/{caseId}/start-assessment', 'a state change with nothing to say'],
  ['post /api/v1/adjustment-cases/{caseId}/request-review', 'a state change with nothing to say'],
  ['post /api/v1/adjustment-cases/{caseId}/close', 'a state change with nothing to say'],
  ['post /api/v1/adjustment-cases/{caseId}/evidence', 'multipart/form-data upload, read with request.file()'],
  ['post /api/v1/admin/retention/apply', 'applies to every case past its date'],
]);

const errors = [];
let operations = 0;
for (const [path, ops] of Object.entries(spec.paths ?? {})) {
  for (const [method, op] of Object.entries(ops)) {
    if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
    operations++;
    const key = `${method} ${path}`;
    if (!op.summary || !op.tags?.length) errors.push(`${key}: no schema (no tags or summary)`);
    for (const [, name] of path.matchAll(/\{(\w+)\}/g)) {
      const param = (op.parameters ?? []).find((p) => p.in === 'path' && p.name === name);
      if (!param) errors.push(`${key}: path parameter ${name} is not declared`);
      else if (/Id$/.test(name) && param.schema?.format !== 'uuid') errors.push(`${key}: ${name} is not a UUID`);
    }
    if (['post', 'put', 'patch'].includes(method) && !op.requestBody && !NO_BODY.has(key)) {
      errors.push(`${key}: no request body schema`);
    }
  }
}
for (const key of NO_BODY.keys()) {
  const [method, path] = key.split(' ');
  if (!spec.paths?.[path]?.[method]) errors.push(`NO_BODY lists ${key}, which no longer exists`);
}

if (errors.length) {
  console.error(`Wellbeing route schema check failed (${errors.length}):\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.warn(`Wellbeing route schema check passed: ${operations} operations, all with schemas.`);
