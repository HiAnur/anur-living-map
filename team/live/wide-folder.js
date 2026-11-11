// Claude never works in the home folder or a folder holding it (/Users, /): read-only Claude runs there confined to
// that folder with the user's own deny rules off, which would hand it all of ~, ~/.ssh included. A map opened in such
// a folder gives Claude the map's own folder instead.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The folder Claude may work in for a map: `folder`, unless it is gone, the home folder or a folder above it.
 * @param {string | undefined} folder @param {string} fallback @param {string} [home]
 */
export function workFolder(folder, fallback, home = os.homedir()) {
  if (!folder || !fs.existsSync(folder)) return fallback;
  const mine = fs.existsSync(home) ? fs.realpathSync(home) : path.resolve(home);
  const up = path.relative(fs.realpathSync(folder), mine);
  // `up` leads from the folder down to home when the folder holds it (or is it); otherwise it climbs out or is absolute
  const holdsHome = up !== '..' && !up.startsWith(`..${path.sep}`) && !path.isAbsolute(up);
  return holdsHome ? fallback : folder;
}
