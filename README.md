# insomnia-plugin-response-budget

[![npm version](https://img.shields.io/npm/v/insomnia-plugin-response-budget.svg)](https://www.npmjs.com/package/insomnia-plugin-response-budget)
[![license: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Local-only response budget reports for Insomnia. Response Budget catches oversized and overly complex API responses before they become frontend performance problems.

## Why

APIs often become slow because responses grow quietly: huge arrays, deeply nested JSON, base64 blobs, logs, or expanded includes. Insomnia can show the response, but it does not explain whether the payload is healthy. This plugin turns a response body into a local budget report with fix ideas.

## Features

- Measures response byte size, characters, and lines
- Parses JSON when possible
- Reports JSON max depth
- Reports largest array length
- Reports JSON node count / complexity
- Reports largest object key count and string length
- Warns on oversized responses after a response hook
- Exports a local Markdown report
- Works without accounts, cloud, telemetry, or dependencies

## Install

From Insomnia:

1. Open **Preferences** → **Plugins**
2. Enter `insomnia-plugin-response-budget`
3. Click **Install Plugin**

Manual macOS install:

```bash
cd "$HOME/Library/Application Support/Insomnia/plugins"
npm install insomnia-plugin-response-budget
```

Linux plugin path:

```text
~/.config/Insomnia/plugins/
```

Windows plugin path:

```text
%APPDATA%\Insomnia\plugins\
```

## Usage

Send a request. If the response breaks the default budget, the plugin shows a local warning.

To export a report, run:

```text
Response Budget: Export Report
```

The action is exposed through:

- `workspaceActions`
- `requestGroupActions`
- `requestActions`

In Insomnia 13, this may appear in the **New Request** dropdown or request/folder action menus.

## Default budgets

```text
maxBytes: 102400
maxJsonDepth: 8
maxArrayLength: 500
maxNodeCount: 5000
maxStringLength: 10000
```

## Example report

```markdown
# Insomnia Response Budget Report

## Summary

- Budget result: fail
- Quality score: 35/100
- Body size: 210 KB (215040 bytes)
- JSON parsed: yes

## Findings

| Severity | Type | Message | Value | Limit | Fix |
|---|---|---|---:|---:|---|
| high | response-too-large | Response body exceeds byte budget. | 215040 | 102400 | Paginate, filter fields, compress, or move bulk data behind a download endpoint. |
| medium | array-too-large | Largest JSON array exceeds length budget. | 900 | 500 | Add pagination, cursors, or server-side limits. |
```

## Privacy

Response Budget is local-only.

- No backend
- No telemetry
- No accounts
- No credentials
- No dependencies
- Local Markdown export only

## Development

```bash
git clone https://github.com/oliviajohns5/insomnia-plugin-response-budget.git
cd insomnia-plugin-response-budget
npm test
npm run test:hard
npm run test:packaged
npm pack --dry-run
```

## Verified QA

- `node --check main.js`
- `node --check test.js`
- `node --check hard-qa.js`
- `node --check real-insomnia-packaged-test.js`
- `node --check qa-packaged.js`
- `npm test`
- `npm run test:hard`
- `npm run test:packaged`
- `npm pack --dry-run`
- isolated tarball install
- package metadata validation
- credential literal scan

## License

MIT
