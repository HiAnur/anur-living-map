// The Node the team map needs. Its store is node:sqlite, built into Node without a flag from 22.13 (23.4 on 23),
// and `node users.js` runs only where import.meta.main is set: 22.18 on 22, 24.2 from 24, never
// 23. Older Node starts the server and then fails with errors that say nothing about Node, so bin.js asks first.

export const NODE_NEEDED = 'Node 22.18 or newer on Node 22, or 24.2 or newer';

/** Whether a Node version (process.versions.node) is too old for the map. @param {string} version */
export function nodeTooOld(version) {
  const [major, minor] = version.split('.').map(Number);
  return major === 22 ? minor < 18 : major === 24 ? minor < 2 : major < 24;
}
