// Installs the team map's skill, anur-living-map, into your own Claude Code: the folder beside this file, copied file
// for file into ~/.claude/skills/ (CLAUDE_CONFIG_DIR moves it). `npm run skill` runs it; the skill's own
// open-map.sh refreshes an installed copy each time it runs.
//
//   node team/skill/install.js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FROM = path.join(import.meta.dirname, 'anur-living-map');

export const teamSkillDir = () =>
  path.join(
    process.env.CLAUDE_CONFIG_DIR ? path.resolve(process.env.CLAUDE_CONFIG_DIR) : path.join(os.homedir(), '.claude'),
    'skills',
    'anur-living-map',
  );

/**
 * The skill, file for file. Each file is written beside its place and moved over it: the skill's script copies itself
 * the same way, since a shell reading a script written in place would tear it mid-line.
 * @param {{ dir?: string, from?: string }} [o]
 * @returns {'installed' | 'updated' | 'unchanged'}
 */
export function installTeamSkill({ dir = teamSkillDir(), from = FROM } = {}) {
  const had = fs.existsSync(dir);
  let changed = false;
  for (const d of fs.readdirSync(from, { recursive: true, withFileTypes: true })) {
    if (!d.isFile()) continue;
    const src = path.join(d.parentPath, d.name);
    const dst = path.join(dir, path.relative(from, src));
    let same = false;
    try {
      same = fs.readFileSync(dst).equals(fs.readFileSync(src));
    } catch {
      // not there yet
    }
    if (same) continue;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, `${dst}.new`);
    fs.renameSync(`${dst}.new`, dst);
    changed = true;
  }
  return !changed ? 'unchanged' : had ? 'updated' : 'installed';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = installTeamSkill();
  const said = r === 'unchanged' ? 'Already installed' : r === 'updated' ? 'Updated' : 'Installed';
  console.log(
    `${said}: ${teamSkillDir()}\nIn a Claude Code chat inside any repo, say "/anur-living-map" to open the team's map of it.`,
  );
}
