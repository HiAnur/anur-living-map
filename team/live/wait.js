// The listener /anur-living-map starts in the background of a Claude Code chat:
//
//   node wait.js <port> <map> <session id>        map: "gtm" for /gtm/, "" for the project's own map
//
// It waits until someone does something on the map that belongs to this chat (answers its
// question, applies a change Claude proposed, comments on its boxes), prints it and ends, and its
// ending wakes the chat. If the map server stays down for a minute, it says so and ends.

const [port = '4323', map = '', session = ''] = process.argv.slice(2);
const base = `http://localhost:${port}${map ? `/${map}` : ''}`;
if (!session) {
  console.log('No session id, so the map cannot tell which chat this is. Start the listener again with the chat\'s session id.');
  process.exit(0);
}

let down = 0;
for (;;) {
  try {
    const r = await fetch(`${base}/api/wait?session=${encodeURIComponent(session)}`);
    const text = (await r.text()).trim();
    down = 0;
    if (r.ok && text) {
      console.log(`FROM YOUR LIVING MAP (${base}/):\n${text}`);
      process.exit(0);
    }
    if (!r.ok) await new Promise((ok) => setTimeout(ok, 2000));
  } catch {
    if (++down > 30) {
      console.log(`The Living Map server at ${base}/ is not running, so the listener stopped. Open the map again with /anur-living-map.`);
      process.exit(0);
    }
    await new Promise((ok) => setTimeout(ok, 2000));
  }
}
