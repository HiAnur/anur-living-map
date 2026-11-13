// Which builds a copy of the map updates to. Every push to main that passes CI is tagged dev-<version>; a build
// becomes a release (v<version>) only when someone runs the Release workflow. A copy on the stable channel, the
// default and what customers run, moves only to releases; one on the dev channel (the team) moves to every
// passing build, releases included. ANUR_LIVING_MAP_CHANNEL picks it, else a `channel` file in the data folder
// (data-dir.js), so a choice outlives a restart; open-map.sh reads the same two the same way.
import fs from 'node:fs';
import path from 'node:path';

/** @typedef {'stable' | 'dev'} Channel */

/**
 * The channel this copy follows: `dev` only when asked for, anything else is stable.
 * @param {Record<string, string | undefined>} env @param {string} dataDir @returns {Channel}
 */
export function channelOf(env, dataDir) {
  let asked = env.ANUR_LIVING_MAP_CHANNEL;
  if (!asked) { try { asked = fs.readFileSync(path.join(dataDir, 'channel'), 'utf8'); } catch { /* no file: the default channel */ } }
  return String(asked || '').trim().toLowerCase() === 'dev' ? 'dev' : 'stable';
}

/**
 * The tags a channel moves to, as `git describe --match` patterns.
 * @param {Channel} channel @returns {string[]}
 */
export const tagsFor = (channel) => (channel === 'dev' ? ['dev-[0-9]*', 'v[0-9]*'] : ['v[0-9]*']);
