'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const plugin = require('./main');
const t = plugin.__test;

async function main() {
  assert(Array.isArray(plugin.responseHooks));
  assert(Array.isArray(plugin.requestActions));
  assert(Array.isArray(plugin.requestGroupActions));
  assert(Array.isArray(plugin.workspaceActions));

  const sample = JSON.stringify({
    ok: true,
    users: Array.from({ length: 120 }, (_, i) => ({ id: i, name: 'User ' + i, tags: ['alpha', 'beta', 'gamma'] })),
    meta: { page: 1, total: 120 },
  });

  const metrics = t.analyzePayload(sample);
  assert(metrics.bytes > 1000);
  assert.strictEqual(metrics.json.valid, true);
  assert.strictEqual(metrics.json.topLevelType, 'object');
  assert(metrics.json.nodeCount > 700);
  assert(metrics.json.maxDepth >= 4);
  assert(metrics.json.maxArrayLength === 120);
  assert(metrics.json.hotPaths.some(p => p.path === '$.users' && p.kind === 'array'));

  const report = t.evaluateBudget(metrics, {
    maxBytes: 1000,
    maxJsonDepth: 3,
    maxArrayLength: 100,
    maxNodeCount: 500,
  });
  const types = new Set(report.findings.map(f => f.type));
  assert.strictEqual(report.status, 'fail');
  assert(types.has('response-too-large'));
  assert(types.has('json-too-deep'));
  assert(types.has('array-too-large'));
  assert(types.has('json-too-complex'));
  assert(report.score < 70);

  const deepBody = '['.repeat(12000) + '1' + ']'.repeat(12000);
  const deep = t.evaluateBudget(t.analyzePayload(deepBody), t.DEFAULT_BUDGETS);
  assert.strictEqual(deep.metrics.json.valid, true);
  assert.strictEqual(deep.metrics.json.maxDepth, 12001);
  assert.strictEqual(deep.metrics.json.nodeCount, 12001);
  assert.deepStrictEqual(deep.findings.map(f => f.type), ['json-too-deep', 'json-too-complex']);
  assert.strictEqual(deep.status, 'warn');

  const deeper = t.analyzePayload('{"a":'.repeat(20000) + '0' + '}'.repeat(20000));
  assert.strictEqual(deeper.json.valid, true);
  assert.strictEqual(deeper.json.maxDepth, 20001);
  assert.strictEqual(deeper.json.maxObjectKeys, 1);
  assert.strictEqual(deeper.json.nodeCount, 20001);

  const wideObject = Object.fromEntries(Array.from({ length: 26 }, (_, i) => [`k${i}`, null]));
  const wideArray = Array.from({ length: 26 }, (_, i) => i);
  const mixed = t.analyzePayload(JSON.stringify({
    first: 'x'.repeat(257),
    second: 'y'.repeat(257),
    list: wideArray,
    object: wideObject,
  }));
  assert.strictEqual(mixed.json.maxDepth, 3);
  assert.strictEqual(mixed.json.maxArrayLength, 26);
  assert.strictEqual(mixed.json.maxObjectKeys, 26);
  assert.strictEqual(mixed.json.maxStringLength, 257);
  assert.strictEqual(mixed.json.nodeCount, 57);
  assert.deepStrictEqual(mixed.json.hotPaths.map(({ path, kind }) => [path, kind]), [
    ['$.object', 'object'], ['$.first', 'string'], ['$.second', 'string'], ['$.list', 'array'],
  ]);
  assert.deepStrictEqual(mixed.json.hotPaths.map(({ bytes }) => bytes), [
    Buffer.byteLength(JSON.stringify(wideObject)), 259, 259,
    Buffer.byteLength(JSON.stringify(wideArray)),
  ]);

  const deepWideBody = '[' + Array.from({ length: 26 }, (_, i) => i === 0 ? '['.repeat(12000) + '1' + ']'.repeat(12000) : 'null').join(',') + ']';
  const deepWide = t.analyzePayload(deepWideBody);
  assert.strictEqual(deepWide.json.valid, true);
  assert.strictEqual(deepWide.json.maxDepth, 12002);
  assert.deepStrictEqual(deepWide.json.hotPaths, [
    { path: '$', kind: 'array', bytes: Buffer.byteLength(deepWideBody) },
  ]);

  const nestedWide = Array.from({ length: 26 }, (_, i) => ({
    id: i,
    values: Array.from({ length: 2000 }, (_, j) => j),
  }));
  const nestedWideBody = JSON.stringify(nestedWide);
  const nestedWideMetrics = t.analyzePayload(nestedWideBody);
  assert.strictEqual(nestedWideMetrics.json.valid, true);
  assert.strictEqual(nestedWideMetrics.json.maxArrayLength, 2000);
  assert.strictEqual(nestedWideMetrics.json.nodeCount, 52079);
  assert.deepStrictEqual(nestedWideMetrics.json.hotPaths.map(p => p.path), [
    '$', '$[0].values', '$[1].values', '$[2].values', '$[3].values',
    '$[4].values', '$[5].values', '$[6].values', '$[7].values', '$[8].values',
  ]);
  assert.strictEqual(nestedWideMetrics.json.hotPaths[0].bytes, Buffer.byteLength(nestedWideBody));
  assert.strictEqual(nestedWideMetrics.json.hotPaths[1].bytes,
    Buffer.byteLength(JSON.stringify(nestedWide[0].values)));

  const escapedObject = Object.fromEntries(Array.from({ length: 26 }, (_, i) =>
    [i === 0 ? 'é\\"\n' : `k${i}`, i === 0 ? '😀\\"\n' : null]));
  const escapedBody = JSON.stringify({ escapedObject });
  const escaped = t.analyzePayload(escapedBody);
  assert.deepStrictEqual(escaped.json.hotPaths, [
    { path: '$.escapedObject', kind: 'object', bytes: Buffer.byteLength(JSON.stringify(escapedObject)) },
  ]);

  const many = t.analyzePayload(JSON.stringify(Array.from({ length: 26 }, (_, i) => 'x'.repeat(257 + i))));
  assert.strictEqual(many.json.hotPaths.length, 10);
  assert.deepStrictEqual(many.json.hotPaths.map(p => p.path), [
    '$', '$[25]', '$[24]', '$[23]', '$[22]', '$[21]', '$[20]', '$[19]', '$[18]', '$[17]',
  ]);

  const ties = t.analyzePayload(JSON.stringify(Array.from({ length: 26 }, () => 'x'.repeat(257))));
  assert.deepStrictEqual(ties.json.hotPaths.map(p => p.path), [
    '$', '$[0]', '$[1]', '$[2]', '$[3]', '$[4]', '$[5]', '$[6]', '$[7]', '$[8]',
  ]);

  const small = t.evaluateBudget(t.analyzePayload('{"ok":true}'), t.DEFAULT_BUDGETS);
  assert.strictEqual(small.status, 'pass');
  assert.strictEqual(small.findings.length, 0);

  const invalid = t.analyzePayload('not json');
  assert.strictEqual(invalid.json.valid, false);
  assert.strictEqual(t.evaluateBudget(invalid, t.DEFAULT_BUDGETS).status, 'pass');

  const md = t.makeMarkdown(report);
  assert(md.includes('# Insomnia Response Budget Report'));
  assert(md.includes('response-too-large'));
  assert(md.includes('## Metrics'));
  assert(md.includes('## Fix Ideas'));
  assert(md.includes('## Largest JSON Hotspots'));
  assert(md.includes('$.users'));
  assert.strictEqual(t.normalizeSaveDialogResult('/tmp/report.md'), '/tmp/report.md');
  assert.strictEqual(t.normalizeSaveDialogResult({ filePath: '/tmp/report.md', canceled: false }), '/tmp/report.md');
  assert.strictEqual(t.normalizeSaveDialogResult({ canceled: true }), null);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'response-budget-'));
  try {
    const out = path.join(tmp, 'budget.md');
    const alerts = [];
    const ctx = {
      response: {
        getBody: async () => Buffer.from(sample),
        statusCode: 200,
        headers: [['Content-Type', 'application/json']],
      },
      app: {
        showSaveDialog: async () => out,
        getPath: async () => tmp,
        alert: async (title, message) => alerts.push({ title, message }),
      },
    };
    await plugin.requestActions[0].action(ctx);
    const text = fs.readFileSync(out, 'utf8');
    assert(text.includes('Insomnia Response Budget Report'));
    const sidecarPath = path.join(tmp, 'budget.json');
    assert.strictEqual(t.jsonSidecarPath(out), sidecarPath);
    const sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
    assert.strictEqual(sidecar.status, 'pass');
    assert.strictEqual(sidecar.metrics.json.valid, true);
    assert.deepStrictEqual(Object.keys(sidecar).sort(), ['budget', 'findings', 'metrics', 'score', 'status']);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(sidecar, 'body'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(sidecar, 'responseBody'), false);
    assert.strictEqual(alerts.length, 1);

    const objectOut = path.join(tmp, 'object.md');
    await plugin.requestActions[0].action({
      response: { getBody: async () => Buffer.from(sample) },
      app: {
        showSaveDialog: async () => ({ filePath: objectOut, canceled: false }),
        getPath: async () => tmp,
        alert: async () => {},
      },
    });
    assert(fs.existsSync(objectOut), 'object save dialog writes Markdown');
    assert(fs.existsSync(path.join(tmp, 'object.json')), 'object save dialog writes JSON sidecar');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  const hookAlerts = [];
  const largePayload = JSON.stringify({ data: 'x'.repeat(t.DEFAULT_BUDGETS.maxBytes + 1) });
  await plugin.responseHooks[0]({
    response: { getBody: async () => Buffer.from(largePayload) },
    app: { alert: async (title, message) => hookAlerts.push({ title, message }) },
  });
  assert.strictEqual(hookAlerts.length, 1);
  assert(hookAlerts[0].message.includes('Response Budget'));

  console.log('PASS: all tests');
}

main().catch(err => { console.error(err.stack || err); process.exit(1); });
