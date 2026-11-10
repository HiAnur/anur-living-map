import fs from 'node:fs';
import path from 'node:path';
const target = process.argv[2];
if (!target || fs.existsSync(target)) throw new Error('Choose a new build-context directory.');
fs.mkdirSync(path.join(target, 'live'), { recursive: true });
fs.mkdirSync(path.join(target, 'cloud'));
// live/: every module the cloud server can reach through ../live/server.js, by pattern so a new module is never
// left out, and the page with what it reads; never tests, maps or local configuration
const live = path.resolve(import.meta.dirname, '../live');
const code = (/** @type {string} */ f) => f.endsWith('.js') && !/\.(test|harness)\.js$/.test(f);
for (const name of [...fs.readdirSync(live).filter(code), 'index.html', 'seed.json', 'chat-rules.md', 'package.json']) fs.copyFileSync(path.join(live, name), path.join(target, 'live', name));
for (const name of /** @type {string[]} */ (fs.readdirSync(path.join(live, 'agents'), { recursive: true })).filter(code)) {
  fs.mkdirSync(path.dirname(path.join(target, 'live', 'agents', name)), { recursive: true });
  fs.copyFileSync(path.join(live, 'agents', name), path.join(target, 'live', 'agents', name));
}
for (const name of ['server.js','store.js']) fs.copyFileSync(path.join(import.meta.dirname, name), path.join(target, 'cloud', name));
fs.copyFileSync(path.join(import.meta.dirname, 'Dockerfile'), path.join(target, 'Dockerfile'));
fs.writeFileSync(path.join(target, 'package.json'), '{"type":"module"}\n');
