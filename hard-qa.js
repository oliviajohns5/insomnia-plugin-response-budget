'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const plugin = require('./main');
const t = plugin.__test;

async function run() {
  const results = [];
  async function check(name, fn) {
    await fn();
    results.push(name);
    console.log('PASS | ' + name);
  }

  await check('exports action arrays and response hook', () => {
    assert(Array.isArray(plugin.responseHooks));
    assert(Array.isArray(plugin.workspaceActions));
    assert(Array.isArray(plugin.requestGroupActions));
    assert(Array.isArray(plugin.requestActions));
  });

  await check('empty payload is pass', () => {
    const report = t.evaluateBudget(t.analyzePayload(''), t.DEFAULT_BUDGETS);
    assert.strictEqual(report.status, 'pass');
  });

  await check('invalid JSON is still size-measured', () => {
    const report = t.evaluateBudget(t.analyzePayload('not json'), { ...t.DEFAULT_BUDGETS, maxBytes: 2 });
    assert.strictEqual(report.metrics.json.valid, false);
    assert(report.findings.some(f => f.type === 'response-too-large'));
  });

  await check('deep JSON is flagged', () => {
    const body = JSON.stringify({ a: { b: { c: { d: { e: true } } } } });
    const report = t.evaluateBudget(t.analyzePayload(body), { ...t.DEFAULT_BUDGETS, maxJsonDepth: 3 });
    assert(report.findings.some(f => f.type === 'json-too-deep'));
  });

  await check('large array is flagged', () => {
    const body = JSON.stringify({ rows: Array.from({ length: 12 }, (_, i) => i) });
    const report = t.evaluateBudget(t.analyzePayload(body), { ...t.DEFAULT_BUDGETS, maxArrayLength: 10 });
    assert(report.findings.some(f => f.type === 'array-too-large'));
  });

  await check('node complexity is flagged', () => {
    const body = JSON.stringify({ rows: Array.from({ length: 20 }, (_, i) => ({ id: i, v: i })) });
    const report = t.evaluateBudget(t.analyzePayload(body), { ...t.DEFAULT_BUDGETS, maxNodeCount: 10 });
    assert(report.findings.some(f => f.type === 'json-too-complex'));
  });

  await check('large string is flagged', () => {
    const body = JSON.stringify({ blob: 'x'.repeat(40) });
    const report = t.evaluateBudget(t.analyzePayload(body), { ...t.DEFAULT_BUDGETS, maxStringLength: 10 });
    assert(report.findings.some(f => f.type === 'string-too-large'));
  });

  await check('markdown is complete and clean', () => {
    const report = t.evaluateBudget(t.analyzePayload(JSON.stringify({ data: 'x'.repeat(1025) })), { ...t.DEFAULT_BUDGETS, maxBytes: 100 });
    const md = t.makeMarkdown(report);
    assert(md.includes('# Insomnia Response Budget Report'));
    assert(md.includes('## Metrics'));
    assert(md.includes('## Findings'));
    assert(md.includes('## Fix Ideas'));
    assert(!md.includes('undefined'));
    assert(!md.includes('null'));
  });

  await check('action writes fallback path report', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'response-budget-hard-'));
    try {
      const alerts = [];
      const ctx = {
        response: { getBody: async () => Buffer.from(JSON.stringify({ ok: true })) },
        app: { showSaveDialog: async () => null, getPath: async () => tmp, alert: async (title, message) => alerts.push({ title, message }) },
      };
      await plugin.requestActions[0].action(ctx);
      const files = fs.readdirSync(tmp).filter(f => f.endsWith('.md'));
      assert(files.length === 1);
      assert(fs.readFileSync(path.join(tmp, files[0]), 'utf8').includes('Budget result: pass'));
      assert.strictEqual(alerts.length, 1);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  await check('response hook alerts only on fail', async () => {
    const alerts = [];
    await plugin.responseHooks[0]({ response: { getBody: async () => Buffer.from('{"ok":true}') }, app: { alert: async (...args) => alerts.push(args) } });
    assert.strictEqual(alerts.length, 0);
    await plugin.responseHooks[0]({ response: { getBody: async () => Buffer.from(JSON.stringify({ data: 'x'.repeat(t.DEFAULT_BUDGETS.maxBytes + 1) })) }, app: { alert: async (...args) => alerts.push(args) } });
    assert.strictEqual(alerts.length, 1);
  });

  await check('packaged install harness passes', () => {
    childProcess.execFileSync('node', ['qa-packaged.js'], { cwd: process.cwd(), stdio: 'pipe' });
  });

  console.log('HARD_QA_PASS ' + results.length + ' checks');
}

run().catch(err => { console.error(err.stack || err); process.exit(1); });
