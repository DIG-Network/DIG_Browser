// Bundle the injected window.chia provider from @dignetwork/chia-provider.
//
// The renderer MAIN world cannot ES-import at runtime, so the shipped provider
// (dig_provider.js) MUST be a single self-contained IIFE. This script bundles the
// entry (dig_provider.entry.mjs) with esbuild — inlining the shared package's
// buildProvider() — into dig_provider.js, the file build.py embeds verbatim into
// the renderer (kDigProviderJs).
//
// Re-run whenever @dignetwork/chia-provider is bumped or the entry changes:
//   cd dig/provider && npm install && npm run build
//
// The output is committed (build.py reads it directly; there is no JS build step
// inside the Chromium build). Minification is OFF so the output stays readable and
// the {{VERSION}} token survives verbatim for build.py's substitution.

import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(here, 'dig_provider.entry.mjs');
const OUT = join(here, 'dig_provider.js');

const HEADER =
  '// Generated from dig_provider.entry.mjs by build-provider.mjs. Do not edit.\n' +
  '// window.chia is derived from @dignetwork/chia-provider (buildProvider) so the\n' +
  '// DIG Browser and the dig-chrome-extension expose the identical provider surface.\n' +
  '// Regenerate: cd dig/provider && npm install && npm run build\n';

// esbuild's IIFE format prepends a `"use strict";` and (when there are no exports)
// emits a bare `(() => { ... })();`. That is exactly a self-contained injectable
// script — no import/export/require survives with bundle:true.
const result = await build({
  entryPoints: [ENTRY],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome111'],
  minify: false,
  legalComments: 'none',
  write: false,
});

let out = result.outputFiles[0].text;
out = HEADER + out;
writeFileSync(OUT, out, 'utf8');

// ---- Post-build guards: fail loudly if the output can't be embedded/injected ----
const problems = [];

// (i) build.py's {{VERSION}} substitution must still fire.
if (!out.includes('{{VERSION}}')) {
  problems.push('missing the {{VERSION}} token (build.py substitution would no-op)');
}

// (ii) It must be a self-contained IIFE: no module syntax may survive bundling.
//     Match top-of-line import/export/require forms (esbuild leaves none with
//     bundle:true, but guard against a future misconfiguration).
if (/^\s*import\s/m.test(out) || /^\s*export\s/m.test(out) || /\brequire\s*\(/.test(out)) {
  problems.push('module syntax (import/export/require) survived — not a self-contained IIFE');
}

// (iii) The R"DIGJS(...)DIGJS" raw-string delimiter build.py wraps this in must not
//      appear inside the payload, or the embedded C++ string would terminate early.
if (out.includes(')DIGJS"')) {
  problems.push('output contains the )DIGJS" delimiter — would break build.py\'s raw string');
}

// (iv) The shared surface must actually be present.
for (const needle of ['window.chia', 'isGoby', 'requestAccounts', 'walletSwitchChain']) {
  if (!out.includes(needle)) problems.push(`output is missing "${needle}" (shared surface not bundled?)`);
}

if (problems.length) {
  console.error('✗ dig_provider.js build failed post-build checks:');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}

const kb = (Buffer.byteLength(out) / 1024).toFixed(1);
console.error(`✓ Bundled dig_provider.js from @dignetwork/chia-provider (${kb} KB, IIFE, {{VERSION}} intact)`);
