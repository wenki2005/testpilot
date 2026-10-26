import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { resolve } from 'node:path';

test('API suite authoring turns untrusted requirements into a validated, traceable deterministic suite', async t => {
  const dataDir = resolve(import.meta.dirname, '..', 'artifacts', 'api-authoring-fixture', String(Date.now()));
  const suite = {
    version: 1,
    name: 'Local inventory API',
    description: 'Contract-grounded checks',
    baseUrl: 'http://127.0.0.1:4317/v1/',
    cases: [
      { id: 'inventory-health-verbose-false', title: 'Inventory health default verbosity', source: 'OpenAPI: GET /health', requirementRefs: ['Service contract: health endpoint'], priority: 'P1', request: { method: 'GET', path: '/health?verbose=false' }, expect: { status: 200, json: { status: 'ok' } } },
      { id: 'inventory-health-verbose-true', title: 'Inventory health verbose mode', source: 'OpenAPI: GET /health', requirementRefs: ['Service contract: health endpoint'], priority: 'P1', request: { method: 'GET', path: '/health?verbose=true' }, expect: { status: 200, json: { status: 'ok' } } },
    ],
  };
  let seenPrompt = '';
  let unsafePath;
  let unsafeTrace = false;
  let undocumentedStatus = false;
  let undocumentedRoleStatus = false;
  const model = createServer(async (req, res) => {
    let body = ''; for await (const part of req) body += part;
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(req.headers.authorization, 'Bearer local-authoring-key');
    const request = JSON.parse(body);
    assert.equal(request.response_format.type, 'json_object');
    seenPrompt = request.messages.map(item => item.content).join('\n');
    res.writeHead(200, { 'content-type': 'application/json' });
    const generated = unsafePath ? { ...suite, cases: suite.cases.map(item => ({ ...item, request: { ...item.request, path: unsafePath } })) }
      : unsafeTrace ? { ...suite, cases: suite.cases.map(item => ({ ...item, source: 'OpenAPI: GET /private' })) }
        : undocumentedStatus ? { ...suite, cases: suite.cases.map(item => ({ ...item, expect: { ...item.expect, status: 404 } })) }
          : undocumentedRoleStatus ? { ...suite, principals: { guest: {}, member: {} }, cases: [...suite.cases, { id: 'health-role-check', title: 'Health access control', source: 'OpenAPI: GET /health', requirementRefs: ['Service contract: access control'], request: { method: 'GET', path: '/health' }, expect: { status: 200 }, accessControl: { principals: ['guest', 'member'], expectByPrincipal: { guest: { status: 418 }, member: { status: 200 } } } }] } : suite;
    res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(generated) } }] }));
  });
  model.listen(0, '127.0.0.1'); await once(model, 'listening');
  process.env.TESTPILOT_DATA_DIR = dataDir;
  process.env.TESTPILOT_API_KEY = 'local-authoring-key';
  process.env.OPENAI_API_KEY = '';
  process.env.TESTPILOT_BASE_URL = `http://127.0.0.1:${model.address().port}/v1`;
  process.env.TESTPILOT_MODEL = 'local-authoring-fixture';
  t.after(async () => { model.closeAllConnections(); await new Promise(done => model.close(done)); });

  const { generateApiSuite } = await import('../dist/adapters/api-suite-authoring.js');
  const { calculateOpenApiCoverage } = await import('../dist/storage/api-suite-loader.js');
  const openApi = `openapi: 3.1.0
info:
  title: Inventory API
  version: 1.0.0
paths:
  /health:
    get:
      operationId: getHealth
      summary: Readiness probe
      parameters:
        - name: verbose
          in: query
          required: false
          schema: { type: boolean, default: false, enum: [false, true] }
      responses:
        '200':
          description: ready
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Health' }
        '400': { description: invalid input }
        '401': { description: unauthenticated }
        '403': { description: forbidden }
  /version:
    get:
      operationId: getVersion
      summary: Version information
      responses:
        '200':
          description: version is returned
components:
  schemas:
    Health:
      type: object
      required: [status]
      properties:
        status: { type: string, enum: [ok] }
        tree: { $ref: '#/components/schemas/Node' }
    Node:
      type: object
      properties:
        children:
          type: array
          items: { $ref: '#/components/schemas/Node' }
  securitySchemes:
    bearerAuth: { type: http, scheme: bearer }
security:
  - bearerAuth: []`;
  const output = await generateApiSuite(suite.baseUrl, 'Health endpoint must report readiness.', openApi, []);
  const output30 = await generateApiSuite(suite.baseUrl, 'Health endpoint must report readiness.', openApi.replace('3.1.0', '3.0.3'), []);
  assert.equal(output.name, suite.name);
  assert.equal(output.baseUrl, suite.baseUrl);
  assert.equal(output.cases[0].request.path, '/v1/health?verbose=false', 'paths must be resolved under a versioned base prefix');
  assert.equal(output.cases[0].source, 'OpenAPI: GET /health');
  assert.equal(output.cases[0].priority, 'P1');
  assert.deepEqual(output.openApiCoverage.operationKeys, ['GET /health', 'GET /version']);
  assert.deepEqual(output.openApiCoverage.coveredOperationKeys, ['GET /health']);
  assert.deepEqual(output.openApiCoverage.scenarios.success.coveredOperationKeys, ['GET /health']);
  assert.deepEqual(output.openApiCoverage.scenarios.authorization.eligibleOperationKeys, ['GET /health', 'GET /version']);
  assert.deepEqual(output.openApiCoverage.scenarios.authorization.coveredOperationKeys, [], 'security declaration alone is not proof of an auth test');
  assert.deepEqual(output.openApiCoverage.scenarios.boundary.eligibleOperationKeys, ['GET /health']);
  assert.deepEqual(output.openApiCoverage.scenarios.boundary.coveredOperationKeys, ['GET /health'], 'both declared query enum values must appear in successful cases');
  assert.deepEqual(output.openApiCoverage.scenarios.boundary.checks?.filter(check => check.operationKey === 'GET /health').map(check => [check.status, check.caseIds]), [['covered', ['inventory-health-verbose-false']], ['covered', ['inventory-health-verbose-true']]]);
  assert.deepEqual(output.openApiCoverage.scenarios.boundary.manualReviewOperationKeys, []);
  const scenarioSuite = {
    ...output,
    principals: { guest: {}, member: {} },
    cases: [
      ...output.cases,
      { id: 'health-invalid-query', title: 'Invalid query rejected', source: 'OpenAPI: GET /health', request: { method: 'GET', path: '/v1/health?verbose=invalid' }, expect: { status: 400 } },
      { id: 'health-roles', title: 'Guest denied and member allowed', source: 'OpenAPI: GET /health', request: { method: 'GET', path: '/v1/health' }, expect: { status: 200 }, accessControl: { principals: ['guest', 'member'], expectByPrincipal: { guest: { status: 403 }, member: { status: 200 } } } },
    ],
  };
  const scenarioCoverage = calculateOpenApiCoverage(scenarioSuite, output.openApiCoverage.operationKeys, output.openApiCoverage.operationFacts);
  assert.deepEqual(scenarioCoverage.scenarios?.error.coveredOperationKeys, ['GET /health']);
  assert.deepEqual(scenarioCoverage.scenarios?.authorization.coveredOperationKeys, ['GET /health']);
  const missingEnumValue = calculateOpenApiCoverage({ ...output, cases: output.cases.slice(0, 1) }, output.openApiCoverage.operationKeys, output.openApiCoverage.operationFacts);
  assert.deepEqual(missingEnumValue.scenarios?.boundary.coveredOperationKeys, []);
  assert.deepEqual(missingEnumValue.scenarios?.boundary.checks?.filter(check => check.operationKey === 'GET /health').map(check => check.status), ['covered', 'missing']);
  assert.equal(output30.openApiCoverage?.operationKeys.length, 2);
  assert.match(seenPrompt, /Health endpoint must report readiness/);
  assert.match(seenPrompt, /PARSED OPENAPI 3 operation index/i);
  assert.match(seenPrompt, /getHealth/);
  assert.match(seenPrompt, /"enum":\["ok"\]/);
  assert.match(seenPrompt, /"\$ref":"#\/components\/schemas\/Node"/);
  assert.match(seenPrompt, /bearerAuth/);
  assert.match(seenPrompt, /untrusted data/);
  unsafePath = '/../private';
  await assert.rejects(() => generateApiSuite(suite.baseUrl, '', '', []), /escapes the Base URL prefix/);
  unsafePath = '/private';
  await assert.rejects(() => generateApiSuite(suite.baseUrl, '', openApi, []), /request path does not match/);
  unsafePath = undefined; unsafeTrace = true;
  await assert.rejects(() => generateApiSuite(suite.baseUrl, '', openApi, []), /absent from the parsed OpenAPI document/);
  unsafeTrace = false; undocumentedStatus = true;
  await assert.rejects(() => generateApiSuite(suite.baseUrl, '', openApi, []), /expects undocumented status 404/);
  undocumentedStatus = false;
  undocumentedRoleStatus = true;
  await assert.rejects(() => generateApiSuite(suite.baseUrl, '', openApi, []), /expects undocumented status 418 for principal guest/);
  undocumentedRoleStatus = false;
  await assert.rejects(() => generateApiSuite(suite.baseUrl, '', openApi.replace('#/components/schemas/Health', 'https://example.invalid/Health'), []), /仅支持文档内 JSON Pointer 引用/);
  await assert.rejects(() => generateApiSuite(suite.baseUrl, '', openApi.replace('#/components/schemas/Health', '#/components/schemas/Missing'), []), /schema 校验失败/);
  await assert.rejects(() => generateApiSuite(suite.baseUrl, '', 'openapi: 3.1.0\ninfo: { title: Broken, version: 1.0.0 }\npaths:\n  /health:\n    get:\n      responses: invalid', []), /OpenAPI 3 schema 校验失败/);
  await assert.rejects(() => generateApiSuite(suite.baseUrl, '', 'openapi: 3.1.0\npaths: [bad', []), /OpenAPI JSON\/YAML/);
  await assert.rejects(() => generateApiSuite(suite.baseUrl, '', 'swagger: "2.0"\npaths: {}', []), /只接受 OpenAPI 3\.0\/3\.1/);
});

test('OpenAPI boundary evidence maps actual path, query, header and JSON body values', async () => {
  const { summarizeOpenApiSpecification, openApiOperationFacts } = await import('../dist/adapters/openapi-summary.js');
  const { calculateOpenApiCoverage } = await import('../dist/storage/api-suite-loader.js');
  const summary = await summarizeOpenApiSpecification(`openapi: 3.1.0
info: { title: Boundary fixture, version: 1.0.0 }
paths:
  /items/{itemId}:
    get:
      parameters:
        - name: itemId
          in: path
          required: true
          schema: { type: integer, enum: [1, 2] }
        - name: limit
          in: query
          schema: { type: integer, minimum: 10, maximum: 100 }
        - name: X-Region
          in: header
          schema: { type: string, enum: [north, south] }
      responses: { "200": { description: ok } }
  /items:
    post:
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [kind, score]
              properties:
                kind: { type: string, enum: [basic, premium] }
                score: { type: number, minimum: 0, exclusiveMaximum: 100 }
      responses:
        "201": { description: created }
        "422": { description: invalid input }
  /validation:
    post:
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [code, ids]
              properties:
                code: { type: string, minLength: 2, maxLength: 4 }
                ids:
                  type: array
                  minItems: 1
                  maxItems: 2
                  items: { type: integer }
      responses:
        "201": { description: accepted }
        "422": { description: input length/count rejected }
  /codes:
    get:
      parameters:
        - name: code
          in: query
          schema: { type: string, enum: [AB, CD], pattern: '^[A-Z]+$' }
      responses: { "200": { description: accepted } }`);
  assert.ok(summary);
  const operationKeys = summary.operations.map(operation => `${operation.method} ${operation.path}`);
  const facts = openApiOperationFacts(summary);
  const suite = {
    version: 1,
    name: 'Boundary fixture',
    baseUrl: 'http://127.0.0.1:4317/v1/',
    cases: [
      { id: 'get-one-north-min', title: 'GET min and enum values', source: 'OpenAPI: GET /items/{itemId}', request: { method: 'GET', path: '/v1/items/1?limit=10', headers: { 'X-Region': 'north' } }, expect: { status: 200 } },
      { id: 'get-two-south-max', title: 'GET max and enum values', source: 'OpenAPI: GET /items/{itemId}', request: { method: 'GET', path: '/v1/items/2?limit=100', headers: { 'X-Region': 'south' } }, expect: { status: 200 } },
      { id: 'post-min', title: 'POST minimum and enum values', source: 'OpenAPI: POST /items', request: { method: 'POST', path: '/v1/items', body: { kind: 'basic', score: 0 } }, expect: { status: 201 } },
      { id: 'post-premium-valid', title: 'POST alternate enum value', source: 'OpenAPI: POST /items', request: { method: 'POST', path: '/v1/items', body: { kind: 'premium', score: 99 } }, expect: { status: 201 } },
      { id: 'post-exclusive-max', title: 'POST exclusive maximum is rejected', source: 'OpenAPI: POST /items', request: { method: 'POST', path: '/v1/items', body: { kind: 'premium', score: 100 } }, expect: { status: 422 } },
      { id: 'length-min', title: 'String minimum length', source: 'OpenAPI: POST /validation', request: { method: 'POST', path: '/v1/validation', body: { code: 'aa', ids: [0] } }, expect: { status: 201 } },
      { id: 'length-max', title: 'String maximum length', source: 'OpenAPI: POST /validation', request: { method: 'POST', path: '/v1/validation', body: { code: 'aaaa', ids: [0, 0] } }, expect: { status: 201 } },
      { id: 'length-too-short', title: 'String below minimum length', source: 'OpenAPI: POST /validation', request: { method: 'POST', path: '/v1/validation', body: { code: 'a', ids: [0] } }, expect: { status: 422 } },
      { id: 'length-too-long', title: 'String above maximum length', source: 'OpenAPI: POST /validation', request: { method: 'POST', path: '/v1/validation', body: { code: 'aaaaa', ids: [0] } }, expect: { status: 422 } },
      { id: 'array-too-few', title: 'Array below minimum count', source: 'OpenAPI: POST /validation', request: { method: 'POST', path: '/v1/validation', body: { code: 'aa', ids: [] } }, expect: { status: 422 } },
      { id: 'array-too-many', title: 'Array above maximum count', source: 'OpenAPI: POST /validation', request: { method: 'POST', path: '/v1/validation', body: { code: 'aa', ids: [0, 0, 0] } }, expect: { status: 422 } },
      { id: 'code-ab', title: 'Code enum AB', source: 'OpenAPI: GET /codes', request: { method: 'GET', path: '/v1/codes?code=AB' }, expect: { status: 200 } },
      { id: 'code-cd', title: 'Code enum CD', source: 'OpenAPI: GET /codes', request: { method: 'GET', path: '/v1/codes?code=CD' }, expect: { status: 200 } },
    ],
  };
  const coverage = calculateOpenApiCoverage(suite, operationKeys, facts);
  assert.deepEqual(coverage.scenarios?.boundary.checks?.filter(check => check.status === 'missing'), []);
  assert.deepEqual(coverage.scenarios?.boundary.checks?.find(check => check.label.includes('exclusiveMaximum'))?.caseIds, ['post-exclusive-max']);
  assert.deepEqual(coverage.scenarios?.boundary.checks?.filter(check => check.operationKey === 'POST /validation' && check.status === 'missing'), []);
  assert.deepEqual(coverage.scenarios?.boundary.coveredOperationKeys, operationKeys.filter(key => key !== 'GET /codes'), 'string and array edge checks count when all generated values and status classes match');
  assert.deepEqual(coverage.scenarios?.boundary.manualReviewOperationKeys, ['GET /codes'], 'fully enumerated values do not override an unresolved pattern constraint');
  const withoutHeader = { ...suite, cases: suite.cases.filter(item => item.id !== 'get-two-south-max') };
  const incomplete = calculateOpenApiCoverage(withoutHeader, operationKeys, facts);
  assert.deepEqual(incomplete.scenarios?.boundary.coveredOperationKeys, ['POST /items', 'POST /validation']);
  assert.ok(incomplete.scenarios?.boundary.checks?.some(check => check.operationKey === 'GET /items/{itemId}' && check.status === 'missing'));
  const forgedCase = { ...suite.cases[0], request: { ...suite.cases[0].request, path: '/v1/not-items/1?limit=10' } };
  const forgedCoverage = calculateOpenApiCoverage({ ...suite, cases: [forgedCase] }, operationKeys, facts);
  assert.deepEqual(forgedCoverage.coveredOperationKeys, [], 'a matching source string cannot hide a path mismatch');
  const undocumentedExpectation = { ...suite.cases[0], expect: { status: 201 } };
  const undocumentedCoverage = calculateOpenApiCoverage({ ...suite, cases: [undocumentedExpectation] }, operationKeys, facts);
  assert.deepEqual(undocumentedCoverage.coveredOperationKeys, [], 'an undocumented expected status cannot claim trace coverage');

  const summary30 = await summarizeOpenApiSpecification(`openapi: 3.0.3
info: { title: OAS 3.0 exclusive boundary, version: "1.0" }
paths:
  /quantity:
    get:
      parameters:
        - name: amount
          in: query
          schema: { type: integer, minimum: 1, exclusiveMinimum: true }
      responses: { "200": { description: ok }, "422": { description: invalid } }`);
  assert.ok(summary30);
  const minimumFact = openApiOperationFacts(summary30)[0];
  assert.equal(minimumFact.boundaryRequirements?.[0]?.expectedStatus, 'error', 'OpenAPI 3.0 boolean exclusiveMinimum treats the declared threshold as invalid');
});
