// The /anur-living-map skill's installed copy, as `npx anur-living-map`, the one-click update and open-map.sh make
// it: every file of the skill, each written beside its place and moved over it. bash reads a running script by
// offset, so writing over open-map.sh while /anur-living-map runs would tear it mid-line.
import fs from 'node:fs';
import path from 'node:path';

/**
 * Copies the skill in `src` over the copy in `dst`; whether any file changed.
 * @param {string} src @param {string} dst
 */
export function copySkill(src, dst) {
  let changed = false;
  for (const f of /** @type {string[]} */ (fs.readdirSync(src, { recursive: true }))) {
    const s = path.join(src, f), d = path.join(dst, f);
    if (fs.statSync(s).isDirectory()) continue;
    let same = false;
    try { same = fs.readFileSync(d).equals(fs.readFileSync(s)); } catch { /* not there yet */ }
    if (same) continue;
    fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(s, `${d}.new`); fs.renameSync(`${d}.new`, d);
    changed = true;
  }
  return changed;
}
