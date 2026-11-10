import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Where the team map keeps what is not in a repo: its users, cloud and mail config, logs and the revision the
// running server started from. ~/.anur-living-map, apart from the chat map's ~/.living-map; a Mac that already
// has the old ~/.living-map-2 and not the new folder keeps using it, so its people and sign-ins stay with
// nothing moved. open-map.sh picks the same folder the same way.
/** @param {string} [home] */
export function dataDir(home = os.homedir()) {
  const now = path.join(home, '.anur-living-map'), before = path.join(home, '.living-map-2');
  return !fs.existsSync(now) && fs.existsSync(before) ? before : now;
}
export const DATA = dataDir();
