/**
 * Keep one editor mounted while its local document changes. Opening a file releases the previous live
 * connection; requests from a document that has left cannot supply data to the next document.
 * @param {{beforeSwitch:() => Promise<boolean>, leaving:() => void, commit:(url:URL, ready:{es:EventSource,state:any} | null) => void | Promise<void>, busy:(on:boolean) => void, failed:(message:string) => void}} deps
 */
export function documentNavigation({ beforeSwitch, leaving, commit, busy, failed }) {
  let active = new URL(location.href), epoch = 0, requested = 0;
  let controller = new AbortController();
  /** @type {Promise<boolean> | null} */ let preparing = null;
  /** @type {(() => void) | null} */ let cancel = null;
  const aborted = () => new DOMException('The document changed.', 'AbortError');
  /** @type {typeof window.fetch} */
  const request = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, active);
    const scoped = url.origin === active.origin && !/^\/api\/(version|me\/)/.test(url.pathname);
    const before = epoch;
    const response = await window.fetch(typeof input === 'string' ? url : input, scoped ? { ...init, signal: init?.signal ? AbortSignal.any([controller.signal, init.signal]) : controller.signal } : init);
    const check = () => { if (scoped && before !== epoch) throw aborted(); };
    check();
    return new Proxy(response, { get(target, key) {
      const value = Reflect.get(target, key, target);
      if (['json', 'text', 'blob', 'arrayBuffer', 'formData'].includes(String(key))) return async () => { const data = await value.call(target); check(); return data; };
      return typeof value === 'function' ? value.bind(target) : value;
    } });
  };
  /** @param {URL} url @returns {Promise<{es:EventSource,state:any}>} */
  function connect(url) {
    return new Promise((resolve, reject) => {
      const es = new EventSource(new URL('api/events', url));
      const finish = () => { clearTimeout(timer); es.removeEventListener('state', take); es.removeEventListener('error', fail); cancel = null; };
      const take = (/** @type {MessageEvent} */ event) => {
        try { const state = JSON.parse(event.data); finish(); resolve({ es, state }); }
        catch (e) { finish(); es.close(); reject(e); }
      };
      const fail = () => { finish(); es.close(); reject(new Error('This file could not be opened. Try again.')); };
      const timer = setTimeout(fail, 10000);
      cancel = () => { finish(); es.close(); reject(aborted()); };
      es.addEventListener('state', take); es.addEventListener('error', fail);
    });
  }
  /** @param {string} href @param {boolean} [pop] */
  async function navigate(href, pop = false) {
    const url = new URL(href, active);
    if (url.origin !== active.origin || !/^\/[a-z0-9-]+\/$/.test(url.pathname) || url.searchParams.has('share')) return false;
    const ticket = ++requested; cancel?.(); busy(true);
    try {
      preparing ||= beforeSwitch().finally(() => { preparing = null; });
      if (!await preparing) { if (pop && ticket === requested) history.pushState(null, '', active); return true; }
      if (ticket !== requested) return true;
      const ready = url.pathname === active.pathname ? null : (leaving(), await connect(url));
      if (ticket !== requested) { ready?.es.close(); return true; }
      if (ready) { controller.abort(); controller = new AbortController(); epoch++; }
      active = url;
      if (!pop) history.pushState(null, '', url);
      await commit(url, ready);
      return true;
    } catch (/** @type {any} */ e) {
      if (ticket === requested && e.name !== 'AbortError') { if (pop) history.pushState(null, '', active); failed(e.message || 'This file could not be opened. Try again.'); }
      return true;
    } finally { if (ticket === requested) busy(false); }
  }
  window.addEventListener('popstate', () => { void navigate(location.href, true).then((handled) => { if (!handled) location.assign(location.href); }); });
  return { url: () => active, fetch: request, navigate };
}
