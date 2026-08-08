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
console.log('PASS: packaged plugin integration harness');
