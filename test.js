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
    assert.strictEqual(alerts.length, 1);
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
