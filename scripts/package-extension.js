#!/usr/bin/env node
//
// Builds a ready-to-hand-over copy of the extension with a Groq key already
// inside it, so the recipient installs it and starts replying without
// signing up for anything.
//
//   node scripts/package-extension.js --key gsk_xxx --name alex
//
// Produces dist/x-reply-copilot-alex.zip
//
// Give each person their own key. Groq rate limits are per key, so a key
// shared between several people is one quota shared between them, and
// anyone holding the zip can read the key out of it.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'extension');

function parseArgs(argv) {
  const args = {};

  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const name = argv[i].slice(2);
    const next = argv[i + 1];
    args[name] = !next || next.startsWith('--') ? true : (i++, next);
  }

  return args;
}

function fail(message) {
  console.error('Error: ' + message);
  console.error('');
  console.error('Usage: node scripts/package-extension.js --key gsk_xxx [--name alex]');
  console.error('                                         [--model openai/gpt-oss-20b]');
  console.error('                                         [--backend https://your.vercel.app]');
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));

if (!args.key || args.key === true) fail('--key is required');
if (!/^gsk_[A-Za-z0-9]+$/.test(args.key)) {
  fail('--key does not look like a Groq key (expected gsk_...)');
}

const name = args.name && args.name !== true ? String(args.name) : 'shared';
const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'shared';

const outDir = path.join(ROOT, 'dist');
const buildDir = path.join(outDir, 'x-reply-copilot-' + slug);
const zipPath = buildDir + '.zip';

// Start from a clean copy so a previous build never leaks into this one.
fs.rmSync(buildDir, { recursive: true, force: true });
fs.rmSync(zipPath, { force: true });
fs.mkdirSync(buildDir, { recursive: true });
fs.cpSync(SOURCE, buildDir, { recursive: true });

// Replace the declarations rather than appending, so the packaged copy has
// exactly one definition of each and re-running is idempotent.
function bake(file, replacements) {
  const target = path.join(buildDir, file);
  let source = fs.readFileSync(target, 'utf8');

  replacements.forEach(function (pair) {
    const [pattern, replacement] = pair;
    if (!pattern.test(source)) {
      fail('could not find ' + pattern + ' in ' + file + ' - has it been renamed?');
    }
    source = source.replace(pattern, replacement);
  });

  fs.writeFileSync(target, source);
}

const baked = [
  [/const BAKED_API_KEY = '';/, "const BAKED_API_KEY = '" + args.key + "';"]
];

if (args.model && args.model !== true) {
  baked.push([/const BAKED_MODEL = '';/, "const BAKED_MODEL = '" + args.model + "';"]);
}

if (args.backend && args.backend !== true) {
  baked.push([
    /const BACKEND_URL = '[^']*';/,
    "const BACKEND_URL = '" + String(args.backend).replace(/\/$/, '') + "';"
  ]);
}

bake('background.js', baked);
bake('popup.js', baked);

// Name the copy so several installed side by side stay tellable apart.
const manifestPath = path.join(buildDir, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (name !== 'shared') manifest.name = 'X Reply Copilot (' + name + ')';
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

execFileSync('zip', ['-rq', zipPath, path.basename(buildDir)], { cwd: outDir });

const sizeKb = (fs.statSync(zipPath).size / 1024).toFixed(1);

console.log('Built ' + path.relative(ROOT, zipPath) + ' (' + sizeKb + ' KB)');
console.log('  name:    ' + manifest.name + ' v' + manifest.version);
console.log('  key:     ' + args.key.slice(0, 8) + '...' + args.key.slice(-4));
console.log('  model:   ' + (args.model && args.model !== true ? args.model : 'server default'));
console.log('');
console.log('Send them the zip and these steps:');
console.log('  1. Unzip it');
console.log('  2. Open chrome://extensions');
console.log('  3. Turn on Developer mode, top right');
console.log('  4. Click Load unpacked and pick the unzipped folder');
console.log('  5. Go to x.com and use the AI Reply button on any post');
