// Which person a name stands for, among the people known on this install. A name stored or typed before the map
// knew people by their sign-in ("Alex", the first word of a Mac account's full name) still finds "Alex Smith", who
// signed in through Google, as long as no one else could be meant.

/** @param {unknown} name */
const lower = (name) => String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * The person `name` is: the one called exactly that (whatever its case), else the only one whose name starts with
 * it as whole words ("Alex" or "Alex Smith" for "Alex Smith Jr", never "Al"); null when none is, or several could be.
 * @param {unknown} name @param {Iterable<string>} people @returns {string | null}
 */
export function personNamed(name, people) {
  const want = lower(name);
  if (!want) return null;
  const all = [...new Set(people)];
  const exact = all.find((p) => lower(p) === want);
  if (exact) return exact;
  const starts = all.filter((p) => { const l = lower(p); return l.startsWith(want) && /[\s._-]/.test(l[want.length] || ''); });
  return starts.length === 1 ? starts[0] : null;
}
