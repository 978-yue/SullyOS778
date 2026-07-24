#!/usr/bin/env node
/**
 * Vendors the Spider_XHS 4.3.2 browser signer into worker/index.js.
 *
 * Usage:
 *   node scripts/vendor-xhs-comment-signer.mjs
 *   node scripts/vendor-xhs-comment-signer.mjs path/to/xhs_main_260411.js
 *
 * The upstream file is pinned by commit and SHA-256. The small transformations
 * remove its CommonJS crypto import (the Worker supplies its existing MD5
 * implementation), demo execution, and two global prototype mutations.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, '..');
const workerPath = resolve(root, 'worker/index.js');
const upstreamUrl =
  'https://raw.githubusercontent.com/cv-cat/Spider_XHS/b534ddc7d43f931e25ec36f7e00299b678476538/static/xhs_main_260411.js';
const expectedSha256 = 'd442a0ea177ea3f7970f66d25aab68510e0ace9013f1755e682dfa6fcbeecd05';

const sourcePath = process.argv[2] ? resolve(process.argv[2]) : '';
let source = sourcePath
  ? await readFile(sourcePath, 'utf8')
  : await fetch(upstreamUrl).then((response) => {
      if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
      return response.text();
    });

const digest = createHash('sha256').update(source).digest('hex');
if (digest !== expectedSha256) {
  throw new Error(`Unexpected upstream SHA-256: ${digest}`);
}

function replaceOnce(input, search, replacement, label) {
  const first = input.indexOf(search);
  if (first < 0 || input.indexOf(search, first + search.length) >= 0) {
    throw new Error(`Expected exactly one ${label}`);
  }
  return input.slice(0, first) + replacement + input.slice(first + search.length);
}

source = replaceOnce(source, 'var CryptoJs = require("crypto-js");', '', 'CryptoJS import');
source = replaceOnce(
  source,
  "Object.setPrototypeOf(window, Window.prototype)",
  '',
  'window prototype mutation',
);
source = replaceOnce(source, "obj_toString(window, 'Window')", '', 'window toStringTag mutation');
source = replaceOnce(
  source,
  'Object.setPrototypeOf(globalThis, Window.prototype)',
  '',
  'globalThis prototype mutation',
);
source = replaceOnce(
  source,
  'obj_toString(globalThis, "Window")',
  '',
  'globalThis toStringTag mutation',
);

const demoPattern =
  /\nf = '\/api\/sns\/web\/v1\/homefeed[^\r\n]*\r?\nc = [^\r\n]*\r?\nd = [^\r\n]*\r?\nconsole\.log\(window\.mnsv2\(f, c, d\)\)\r?\n/;
if (!demoPattern.test(source)) throw new Error('Demo signature block was not found');
source = source.replace(demoPattern, '\n');

const worker = await readFile(workerPath, 'utf8');
const regionPattern =
  /  \/\* xhs-comment-signer-432:start \*\/[\s\S]*?  \/\* xhs-comment-signer-432:end \*\//;
if (!regionPattern.test(worker)) throw new Error('Signer vendor region was not found');

const encodedSource = JSON.stringify(source)
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029');
const region = [
  '  /* xhs-comment-signer-432:start */',
  `  const XHS_COMMENT_SIGNER_432_SOURCE = ${encodedSource};`,
  '  /* xhs-comment-signer-432:end */',
].join('\n');

await writeFile(workerPath, worker.replace(regionPattern, () => region), 'utf8');
console.log(`Vendored Spider_XHS 4.3.2 signer (${source.length} source chars)`);
