// Reading a request's body, for every route that takes one.

export const body = (/** @type {any} */ req) => new Promise((ok) => { let b = ''; req.on('data', (/** @type {any} */ c) => (b += c)); req.on('end', () => ok(b)); });
// A request's JSON body, or `fallback` when it is not JSON: every route then checks what it got, so a body
// that does not parse reads as an empty request and is refused there.
/** @param {any} req @param {any} fallback */
export const jsonBody = async (req, fallback) => { try { return JSON.parse(await body(req)); } catch { return fallback; } };
