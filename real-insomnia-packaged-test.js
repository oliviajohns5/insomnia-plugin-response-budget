'use strict';

const assert = require('assert');
const plugin = require('insomnia-plugin-response-budget');
const t = plugin.__test;

assert(Array.isArray(plugin.responseHooks), 'responseHooks export');
assert(Array.isArray(plugin.workspaceActions), 'workspaceActions export');
assert(Array.isArray(plugin.requestGroupActions), 'requestGroupActions export');
assert(Array.isArray(plugin.requestActions), 'requestActions export');
assert.strictEqual(plugin.requestActions[0].label, 'Response Budget: Export Report');

const report = t.evaluateBudget(t.analyzePayload(JSON.stringify({ data: 'x'.repeat(t.DEFAULT_BUDGETS.maxBytes + 1) })), t.DEFAULT_BUDGETS);
assert.strictEqual(report.status, 'fail');
assert(report.findings.some(f => f.type === 'response-too-large'));
assert(t.makeMarkdown(report).includes('Insomnia Response Budget Report'));
const sidecar = t.makeJsonSidecar(report);
assert.deepStrictEqual(Object.keys(sidecar).sort(), ['budget', 'findings', 'metrics', 'score', 'status']);
assert.strictEqual(sidecar.status, 'fail');
assert(!JSON.stringify(sidecar).includes('x'.repeat(128)), 'sidecar must not include response body content');
console.log('PASS: packaged plugin integration harness');
