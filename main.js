'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_BUDGETS = Object.freeze({
  maxBytes: 100 * 1024,
  maxJsonDepth: 8,
  maxArrayLength: 500,
  maxNodeCount: 5000,
  maxStringLength: 10000,
});

function safeString(value) {
  if (value == null) return '';
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function byteLength(text) {
  return Buffer.byteLength(safeString(text), 'utf8');
}

function estimateJsonBytes(value) {
  try { return Buffer.byteLength(JSON.stringify(value), 'utf8'); } catch { return 0; }
}

function pushHotPath(state, path, value, kind) {
  state.hotPaths.push({ path, kind, bytes: estimateJsonBytes(value) });
}

function walkJson(value, depth = 1, state, path = '$') {
  state.nodeCount += 1;
  state.maxDepth = Math.max(state.maxDepth, depth);
  if (typeof value === 'string') {
    state.maxStringLength = Math.max(state.maxStringLength, value.length);
    if (value.length > 256) pushHotPath(state, path, value, 'string');
  }
  if (Array.isArray(value)) {
    state.maxArrayLength = Math.max(state.maxArrayLength, value.length);
    if (value.length > 25) pushHotPath(state, path, value, 'array');
    value.forEach((item, index) => walkJson(item, depth + 1, state, `${path}[${index}]`));
  } else if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    state.maxObjectKeys = Math.max(state.maxObjectKeys, keys.length);
    if (keys.length > 25) pushHotPath(state, path, value, 'object');
    for (const key of keys) walkJson(value[key], depth + 1, state, `${path}.${key}`);
  }
}

function analyzePayload(payload) {
  const text = safeString(payload);
  const metrics = {
    bytes: byteLength(text),
    characters: text.length,
    lines: text ? text.split(/\r?\n/).length : 0,
    json: {
      valid: false,
      topLevelType: 'text',
      maxDepth: 0,
      maxArrayLength: 0,
      maxObjectKeys: 0,
      maxStringLength: 0,
      nodeCount: 0,
      hotPaths: [],
      error: '',
    },
  };
  try {
    const parsed = JSON.parse(text);
    metrics.json.valid = true;
    metrics.json.topLevelType = Array.isArray(parsed) ? 'array' : parsed === null ? 'null' : typeof parsed;
    const state = { maxDepth: 0, maxArrayLength: 0, maxObjectKeys: 0, maxStringLength: 0, nodeCount: 0, hotPaths: [] };
    walkJson(parsed, 1, state);
    state.hotPaths = state.hotPaths.sort((a, b) => b.bytes - a.bytes).slice(0, 10);
    Object.assign(metrics.json, state);
  } catch (err) {
    metrics.json.error = err && err.message ? err.message : 'invalid JSON';
  }
  return metrics;
}

function finding(severity, type, message, value, limit, fix, penalty) {
  return { severity, type, message, value, limit, fix, penalty };
}

function evaluateBudget(metrics, budget = DEFAULT_BUDGETS) {
  const findings = [];
  if (metrics.bytes > budget.maxBytes) {
    findings.push(finding('high', 'response-too-large', 'Response body exceeds byte budget.', metrics.bytes, budget.maxBytes, 'Paginate, filter fields, compress, or move bulk data behind a download endpoint.', 30));
  }
  if (metrics.json.valid) {
    if (metrics.json.maxDepth > budget.maxJsonDepth) findings.push(finding('medium', 'json-too-deep', 'JSON nesting exceeds depth budget.', metrics.json.maxDepth, budget.maxJsonDepth, 'Flatten deeply nested objects or split subresources.', 15));
    if (metrics.json.maxArrayLength > budget.maxArrayLength) findings.push(finding('medium', 'array-too-large', 'Largest JSON array exceeds length budget.', metrics.json.maxArrayLength, budget.maxArrayLength, 'Add pagination, cursors, or server-side limits.', 20));
    if (metrics.json.nodeCount > budget.maxNodeCount) findings.push(finding('medium', 'json-too-complex', 'JSON node count exceeds complexity budget.', metrics.json.nodeCount, budget.maxNodeCount, 'Return a smaller representation or make nested includes opt-in.', 20));
    if (metrics.json.maxStringLength > budget.maxStringLength) findings.push(finding('low', 'string-too-large', 'A JSON string exceeds length budget.', metrics.json.maxStringLength, budget.maxStringLength, 'Move large blobs/logs/base64 fields to separate resources.', 10));
  }
  const penalty = findings.reduce((sum, f) => sum + f.penalty, 0);
  const score = Math.max(0, 100 - penalty);
  const status = findings.some(f => f.severity === 'high') ? 'fail' : findings.length ? 'warn' : 'pass';
  return { status, score, metrics, budget, findings };
}

function formatBytes(n) {
  if (!Number.isFinite(n)) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function makeJsonSidecar(report) {
  return {
    status: report.status,
    score: report.score,
    metrics: report.metrics,
    budget: report.budget,
    findings: report.findings,
  };
}

function jsonSidecarPath(markdownPath) {
  const parsed = path.parse(markdownPath);
  const base = parsed.ext.toLowerCase() === '.md' ? parsed.name : parsed.base;
  return path.join(parsed.dir, `${base}.json`);
}

function makeMarkdown(report) {
  const m = report.metrics;
  const j = m.json;
  const rows = report.findings.map(f => `| ${f.severity} | ${f.type} | ${f.message} | ${f.value} | ${f.limit} | ${f.fix.replace(/\|/g, '\\|')} |`).join('\n') || '| low | none | Response is within configured budgets. |  |  |  |';
  const fixes = report.findings.length
    ? report.findings.map((f, i) => `${i + 1}. **${f.type}** — ${f.fix}`).join('\n')
    : 'No budget fixes needed.';
  const hotPaths = j.hotPaths && j.hotPaths.length
    ? j.hotPaths.map(p => `| ${p.path.replace(/\|/g, '\\|')} | ${p.kind} | ${formatBytes(p.bytes)} |`).join('\n')
    : '|  | none |  |';
  return `# Insomnia Response Budget Report\n\nGenerated: ${new Date().toISOString()}\n\nLocal-only report. No network calls, no telemetry, no backend.\n\n## Summary\n\n- Budget result: ${report.status}\n- Quality score: ${report.score}/100\n- Body size: ${formatBytes(m.bytes)} (${m.bytes} bytes)\n- JSON parsed: ${j.valid ? 'yes' : 'no'}\n\n## Metrics\n\n- Characters: ${m.characters}\n- Lines: ${m.lines}\n- JSON top-level type: ${j.topLevelType}\n- JSON max depth: ${j.maxDepth}\n- Largest JSON array: ${j.maxArrayLength}\n- Largest object key count: ${j.maxObjectKeys}\n- Largest string length: ${j.maxStringLength}\n- JSON node count: ${j.nodeCount}\n\n## Largest JSON Hotspots\n\n| Path | Kind | Approx size |\n|---|---|---:|\n${hotPaths}\n\n## Budgets\n\n- Max bytes: ${report.budget.maxBytes}\n- Max JSON depth: ${report.budget.maxJsonDepth}\n- Max array length: ${report.budget.maxArrayLength}\n- Max node count: ${report.budget.maxNodeCount}\n- Max string length: ${report.budget.maxStringLength}\n\n## Findings\n\n| Severity | Type | Message | Value | Limit | Fix |\n|---|---|---|---:|---:|---|\n${rows}\n\n## Fix Ideas\n\n${fixes}\n`;
}


function normalizeSaveDialogResult(result) {
  if (!result) return null;
  if (typeof result === 'string') return result;
  if (typeof result === 'object') {
    if (result.canceled) return null;
    if (typeof result.filePath === 'string' && result.filePath) return result.filePath;
    if (typeof result.path === 'string' && result.path) return result.path;
  }
  return null;
}

async function readResponseBody(context) {
  const response = context && context.response ? context.response : {};
  if (typeof response.getBody === 'function') return safeString(await response.getBody());
  if (typeof response.getBuffer === 'function') return safeString(await response.getBuffer());
  if ('body' in response) return safeString(response.body);
  if ('data' in response) return safeString(response.data);
  return '';
}

async function getWritableExportPath(context, fileName) {
  const candidates = [];
  if (context.app && typeof context.app.getPath === 'function') {
    for (const key of ['documents', 'desktop', 'downloads', 'userData', 'home']) {
      try { const value = await context.app.getPath(key); if (value) candidates.push(value); } catch {}
    }
  }
  candidates.push(process.env.HOME || process.env.USERPROFILE || process.cwd());
  return path.join(candidates.find(Boolean) || '.', fileName);
}

async function exportReport(context) {
  const body = await readResponseBody(context);
  const report = evaluateBudget(analyzePayload(body), DEFAULT_BUDGETS);
  const markdown = makeMarkdown(report);
  let output = null;
  if (context.app && typeof context.app.showSaveDialog === 'function') {
    output = normalizeSaveDialogResult(await context.app.showSaveDialog({ defaultPath: 'insomnia-response-budget-report.md' }));
  }
  if (!output) output = await getWritableExportPath(context, 'insomnia-response-budget-report.md');
  const sidecar = jsonSidecarPath(output);
  fs.writeFileSync(output, markdown, 'utf8');
  fs.writeFileSync(sidecar, JSON.stringify(makeJsonSidecar(report), null, 2) + '\n', 'utf8');
  if (context.app && typeof context.app.alert === 'function') await context.app.alert('Response Budget report exported', `${output}\nJSON sidecar: ${sidecar}`);
}

async function responseHook(context) {
  const body = await readResponseBody(context);
  const report = evaluateBudget(analyzePayload(body), DEFAULT_BUDGETS);
  if (report.status === 'fail' && context.app && typeof context.app.alert === 'function') {
    const top = report.findings[0];
    await context.app.alert('Response Budget warning', `Response Budget: ${top.type}\n${top.message}\nValue: ${top.value}\nLimit: ${top.limit}`);
  }
}

const action = { label: 'Response Budget: Export Report', icon: 'fa-balance-scale', action: exportReport };

module.exports.responseHooks = [responseHook];
module.exports.workspaceActions = [action];
module.exports.requestGroupActions = [action];
module.exports.requestActions = [action];
module.exports.__test = { DEFAULT_BUDGETS, analyzePayload, byteLength, evaluateBudget, exportReport, formatBytes, getWritableExportPath, jsonSidecarPath, makeJsonSidecar, makeMarkdown, normalizeSaveDialogResult, readResponseBody, responseHook };
